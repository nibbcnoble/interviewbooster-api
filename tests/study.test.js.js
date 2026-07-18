const request = require('supertest');
const express = require('express');

const getDb = jest.fn();

jest.mock('../middleware/mongo', () => ({
  getDb
}));

describe('routes/study', () => {
  let app;
  let questionsCollection;
  let progressCollection;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    questionsCollection = {
      find: jest.fn(),
      aggregate: jest.fn()
    };

    progressCollection = {
      findOneAndUpdate: jest.fn(),
      findOne: jest.fn(),
      deleteOne: jest.fn()
    };

    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'questions_az104') return questionsCollection;
        if (name === 'studyTestProgress') return progressCollection;
        throw new Error(`Unexpected collection: ${name}`);
      })
    });

    const router = require('../routes/study');

    app = express();
    app.use(express.json());

    // simple auth injector for tests
    app.use((req, res, next) => {
      req.user = { enc: 'user-123' };
      next();
    });

    app.use('/api/study', router);
  });

  test('POST /api/study/getquestions returns 400 for invalid domain', async () => {
    const res = await request(app)
      .post('/api/study/getquestions')
      .send({ domain: 'invalid_domain' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid domain supplied.' });
  });

  test('POST /api/study/getquestions returns domain questions', async () => {
    const docs = [
      { question: 'Q1', domain: 'compute' },
      { question: 'Q2', domain: 'compute' }
    ];

    const toArray = jest.fn().mockResolvedValue(docs);
    questionsCollection.find.mockReturnValue({ toArray });

    const res = await request(app)
      .post('/api/study/getquestions')
      .send({ domain: 'compute' });

    expect(res.status).toBe(200);
    expect(res.body.selectionType).toBe('domain');
    expect(res.body.domain).toBe('compute');
    expect(res.body.returnedCount).toBe(2);
    expect(res.body.questions).toHaveLength(2);
    expect(questionsCollection.find).toHaveBeenCalled();
  });

  test('POST /api/study/getquestions returns 400 when random count is invalid', async () => {
    const res = await request(app)
      .post('/api/study/getquestions')
      .send({ numberOfQuestions: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'numberOfQuestions must be a positive number when no domain is provided.'
    });
  });

  test('POST /api/study/getquestions returns random questions', async () => {
    const docs = [
      { question: 'Q1', domain: 'networking' },
      { question: 'Q2', domain: 'storage' }
    ];

    const toArray = jest.fn().mockResolvedValue(docs);
    questionsCollection.aggregate.mockReturnValue({ toArray });

    const res = await request(app)
      .post('/api/study/getquestions')
      .send({ numberOfQuestions: 2 });

    expect(res.status).toBe(200);
    expect(res.body.selectionType).toBe('random');
    expect(res.body.requestedCount).toBe(2);
    expect(res.body.returnedCount).toBe(2);
    expect(res.body.questions).toEqual(docs);
  });

  test('POST /api/study/savetestprogress returns 400 when deliveredQuestions is empty', async () => {
    const res = await request(app)
      .post('/api/study/savetestprogress')
      .send({ deliveredQuestions: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'deliveredQuestions must be a non-empty array.'
    });
  });

  test('POST /api/study/savetestprogress saves progress', async () => {
    progressCollection.findOneAndUpdate.mockResolvedValue({
      value: {
        enc: 'user-123',
        examLabel: 'AZ 104',
        submittedTest: false,
        currentIndex: 1
      }
    });

    const payload = {
      examLabel: 'AZ 104',
      deliveredQuestions: [
        { id: 'q1', correct_answer: 'A', domain: 'compute' }
      ],
      answers: { q1: 'A' },
      currentIndex: 1
    };

    const res = await request(app)
      .post('/api/study/savetestprogress')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('Test progress saved.');
    expect(res.body.progress.enc).toBeUndefined();
    expect(progressCollection.findOneAndUpdate).toHaveBeenCalled();
  });

  test('POST /api/study/savetestprogress returns score summary when submittedTest is true', async () => {
    progressCollection.findOneAndUpdate.mockResolvedValue({
      value: {
        enc: 'user-123',
        examLabel: 'AZ 104',
        submittedTest: true
      }
    });

    const payload = {
      submittedTest: true,
      deliveredQuestions: [
        { id: 'q1', correct_answer: 'A', domain: 'compute' },
        { id: 'q2', correct_answer: 'B', domain: 'networking' }
      ],
      answers: {
        q1: 'A',
        q2: 'C'
      }
    };

    const res = await request(app)
      .post('/api/study/savetestprogress')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('Test submitted and saved.');
    expect(res.body.scoreSummary).toEqual({
      total: 2,
      correct: 1,
      percent: 50,
      byDomain: {
        compute: { total: 1, correct: 1 },
        networking: { total: 1, correct: 0 }
      }
    });
  });

  test('GET /api/study/loadtestprogress returns in-progress test', async () => {
    progressCollection.findOne.mockResolvedValue({
      enc: 'user-123',
      examLabel: 'AZ 104',
      currentIndex: 2
    });

    const res = await request(app)
      .get('/api/study/loadtestprogress');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.hasInProgressTest).toBe(true);
    expect(res.body.progress.enc).toBeUndefined();
    expect(res.body.progress.currentIndex).toBe(2);
  });

  test('DELETE /api/study/deletetestprogress deletes matching progress', async () => {
    progressCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const res = await request(app)
      .delete('/api/study/deletetestprogress');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      deletedCount: 1,
      message: 'In-progress test deleted.'
    });
  });

  test('returns 401 when req.user.enc is missing', async () => {
    const router = require('../routes/study');
    const unauthApp = express();
    unauthApp.use(express.json());
    unauthApp.use((req, res, next) => {
      req.user = {};
      next();
    });
    unauthApp.use('/api/study', router);

    const res = await request(unauthApp)
      .get('/api/study/loadtestprogress');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthenticated' });
  });
});
