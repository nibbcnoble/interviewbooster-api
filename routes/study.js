const express = require('express');
const router = express.Router();
const { getDb } = require('../middleware/mongo');

const VALID_DOMAINS = [
  'identity_governance',
  'storage',
  'compute',
  'networking',
  'monitoring',
];

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// helper to pull enc from session
function requireEnc(req, res) {
  const enc = req.user?.enc;
  if (!enc) {
    res.status(401).json({ error: 'Unauthenticated' });
    return null;
  }
  return enc;
}

router.post('/getquestions', async (req, res) => {
  try {
    const db = getDb();
    const questions = db.collection('questions_az104');
    const { domain, numberOfQuestions } = req.body || {};

    if (domain && !VALID_DOMAINS.includes(domain)) {
      return res.status(400).json({ error: 'Invalid domain supplied.' });
    }

    if (domain) {
      const docs = await questions
        .find({ domain }, { projection: { question:1, question_type:1, options:1, correct_answer:1, explanation:1, domain:1 } })
        .toArray();
      return res.json({
        selectionType: 'domain',
        domain,
        returnedCount: docs.length,
        questions: shuffleArray(docs),
      });
    }

    const count = Number(numberOfQuestions);
    if (!count || count < 1) {
      return res.status(400).json({ error: 'numberOfQuestions must be a positive number when no domain is provided.' });
    }
    const pipeline = [
      { $sample: { size: count } },
      { $project: { question:1, question_type:1, options:1, correct_answer:1, explanation:1, domain:1 } },
    ];
    const docs = await questions.aggregate(pipeline).toArray();
    res.json({
      selectionType: 'random',
      requestedCount: count,
      returnedCount: docs.length,
      questions: docs,
    });
  } catch (err) {
    console.error('Error in /api/study/getquestions:', err);
    res.status(500).json({ error: 'Failed to get questions.' });
  }
});

router.post('/savetestprogress', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const db = getDb();
    const coll = db.collection('studyTestProgress');
    const {
      examLabel = 'AZ 104',
      mode = 'practice',
      selection = {},
      currentIndex = 0,
      deliveredQuestions = [],
      answers = {},
      submittedTest = false,
      savedAt,
    } = req.body || {};

    if (!Array.isArray(deliveredQuestions) || deliveredQuestions.length === 0) {
      return res.status(400).json({ error: 'deliveredQuestions must be a non-empty array.' });
    }

    const now = new Date();
    const savedDate = savedAt ? new Date(savedAt) : now;

    let scoreSummary = null;
    if (submittedTest) {
      let correct = 0;
      const byDomain = {};
      for (const q of deliveredQuestions) {
        const userAns = answers[q.id];
        const isCorrect = userAns === q.correct_answer;
        if (isCorrect) correct++;
        byDomain[q.domain] = byDomain[q.domain] || { total:0, correct:0 };
        byDomain[q.domain].total++;
        if (isCorrect) byDomain[q.domain].correct++;
      }
      scoreSummary = {
        total: deliveredQuestions.length,
        correct,
        percent: deliveredQuestions.length ? Math.round((correct / deliveredQuestions.length)*100) : 0,
        byDomain,
      };
    }

    // One active in-progress test per user per examLabel
    const filter = { enc, examLabel, submittedTest: false };
    const update = {
      $set: {
        enc,
        examLabel,
        mode,
        selection: {
          type: selection.type || 'random',
          questionCount: selection.questionCount || null,
          domain: selection.domain || null,
        },
        currentIndex,
        deliveredQuestions,
        answers,
        submittedTest,
        lastSavedAt: savedDate,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    };
    if (submittedTest) {
      update.$set.completedAt = now;
      update.$set.scoreSummary = scoreSummary;
    }

    const result = await coll.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: 'after',
    });

    // strip enc from returned doc
    const returnDoc = result.value ? { ...result.value } : null;
    if (returnDoc) delete returnDoc.enc;

    res.json({
      ok: true,
      message: submittedTest ? 'Test submitted and saved.' : 'Test progress saved.',
      progress: returnDoc,
      scoreSummary,
    });
  } catch (err) {
    console.error('Error in /api/study/savetestprogress:', err);
    res.status(500).json({ error: 'Failed to save test progress.' });
  }
});

router.get('/loadtestprogress', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const examLabel = req.query.examLabel || 'AZ 104';
    const db = getDb();
    const coll = db.collection('studyTestProgress');

    const progress = await coll.findOne(
      { enc, examLabel, submittedTest: false },
      { sort: { updatedAt: -1 } }
    );

    const returnDoc = progress ? { ...progress } : null;
    if (returnDoc) delete returnDoc.enc;

    res.json({
      ok: true,
      hasInProgressTest: !!returnDoc,
      progress: returnDoc,
    });
  } catch (err) {
    console.error('Error in /api/study/loadtestprogress:', err);
    res.status(500).json({ error: 'Failed to load test progress.' });
  }
});

router.delete('/deletetestprogress', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const examLabel = req.query.examLabel || 'AZ 104';
    const db = getDb();
    const coll = db.collection('studyTestProgress');

    const result = await coll.deleteOne({ enc, examLabel, submittedTest: false });
    res.json({
      ok: true,
      deletedCount: result.deletedCount || 0,
      message: result.deletedCount > 0 ? 'In-progress test deleted.' : 'No in-progress test found.',
    });
  } catch (err) {
    console.error('Error in /api/study/deletetestprogress:', err);
    res.status(500).json({ error: 'Failed to delete test progress.' });
  }
});

module.exports = router;
