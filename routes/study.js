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
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

router.post('/getquestions', async (req, res) => {
  try {
    const db = getDb();
    const questionsCollection = db.collection('questions_az104');

    const { domain, numberOfQuestions } = req.body || {};

    if (domain && !VALID_DOMAINS.includes(domain)) {
      return res.status(400).json({
        error: 'Invalid domain supplied.',
      });
    }

    if (domain) {
      const questions = await questionsCollection
        .find(
          { domain },
          {
            projection: {
              question: 1,
              question_type: 1,
              options: 1,
              correct_answer: 1,
              explanation: 1,
              domain: 1,
            },
          }
        )
        .toArray();

      return res.json({
        selectionType: 'domain',
        domain,
        returnedCount: questions.length,
        questions: shuffleArray(questions),
      });
    }

    const parsedCount = Number(numberOfQuestions);

    if (!parsedCount || parsedCount < 1) {
      return res.status(400).json({
        error: 'numberOfQuestions must be a positive number when no domain is provided.',
      });
    }

    const pipeline = [
      { $sample: { size: parsedCount } },
      {
        $project: {
          question: 1,
          question_type: 1,
          options: 1,
          correct_answer: 1,
          explanation: 1,
          domain: 1,
        },
      },
    ];

    const questions = await questionsCollection.aggregate(pipeline).toArray();

    return res.json({
      selectionType: 'random',
      requestedCount: parsedCount,
      returnedCount: questions.length,
      questions,
    });
  } catch (err) {
    console.error('Error in /api/study/getquestions:', err);
    return res.status(500).json({
      error: 'Failed to get questions.',
    });
  }
});

router.post('/savetestprogress', async (req, res) => {
  try {
    const db = getDb();
    const progressCollection = db.collection('studyTestProgress');

    const {
      username,
      examLabel = 'AZ 104',
      mode = 'practice',
      selection = {},
      currentIndex = 0,
      deliveredQuestions = [],
      answers = {},
      submittedTest = false,
      savedAt,
    } = req.body || {};

    if (!username) {
      return res.status(400).json({
        error: 'username is required.',
      });
    }

    if (!Array.isArray(deliveredQuestions) || deliveredQuestions.length === 0) {
      return res.status(400).json({
        error: 'deliveredQuestions must be a non-empty array.',
      });
    }

    const now = new Date();
    const savedDate = savedAt ? new Date(savedAt) : now;

    let scoreSummary = null;

    if (submittedTest) {
      let correct = 0;
      const byDomain = {};

      for (const q of deliveredQuestions) {
        const questionId = q.id;
        const userAnswer = answers[questionId];
        const isCorrect = userAnswer === q.correct_answer;

        if (isCorrect) correct += 1;

        if (!byDomain[q.domain]) {
          byDomain[q.domain] = {
            total: 0,
            correct: 0,
          };
        }

        byDomain[q.domain].total += 1;
        if (isCorrect) byDomain[q.domain].correct += 1;
      }

      scoreSummary = {
        total: deliveredQuestions.length,
        correct,
        percent: deliveredQuestions.length
          ? Math.round((correct / deliveredQuestions.length) * 100)
          : 0,
        byDomain,
      };
    }

    // One active in-progress test per user per examLabel
    const filter = {
      username,
      examLabel,
      submittedTest: false,
    };

    const update = {
      $set: {
        username,
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
      $setOnInsert: {
        createdAt: now,
      },
    };

    if (submittedTest) {
      update.$set.completedAt = now;
      update.$set.scoreSummary = scoreSummary;
    }

    const result = await progressCollection.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: 'after',
    });

    return res.json({
      ok: true,
      message: submittedTest
        ? 'Test submitted and saved.'
        : 'Test progress saved.',
      progress: result.value || null,
      scoreSummary,
    });
  } catch (err) {
    console.error('Error in /api/study/savetestprogress:', err);
    return res.status(500).json({
      error: 'Failed to save test progress.',
    });
  }
});

router.get('/loadtestprogress', async (req, res) => {
  try {
    const db = getDb();
    const progressCollection = db.collection('studyTestProgress');

    const username = req.user?.email;
    const examLabel = req.query.examLabel || 'AZ 104';

    if (!username) {
      return res.status(400).json({
        error: 'Authenticated user email not found.',
      });
    }

    const progress = await progressCollection.findOne(
      {
        username,
        examLabel,
        submittedTest: false,
      },
      {
        sort: { updatedAt: -1 },
      }
    );

    return res.json({
      ok: true,
      hasInProgressTest: !!progress,
      progress: progress || null,
    });
  } catch (err) {
    console.error('Error in /api/study/loadtestprogress:', err);
    return res.status(500).json({
      error: 'Failed to load test progress.',
    });
  }
});

router.delete('/deletetestprogress', async (req, res) => {
  try {
    const db = getDb();
    const progressCollection = db.collection('studyTestProgress');

    const username = req.user?.email;
    const examLabel = req.query.examLabel || 'AZ 104';

    if (!username) {
      return res.status(400).json({
        error: 'Authenticated user email not found.',
      });
    }

    const result = await progressCollection.deleteOne({
      username,
      examLabel,
      submittedTest: false,
    });

    return res.json({
      ok: true,
      deletedCount: result.deletedCount || 0,
      message:
        result.deletedCount > 0
          ? 'In-progress test deleted.'
          : 'No in-progress test found.',
    });
  } catch (err) {
    console.error('Error in /api/study/deletetestprogress:', err);
    return res.status(500).json({
      error: 'Failed to delete test progress.',
    });
  }
});

module.exports = router;
