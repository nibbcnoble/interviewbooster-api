const request = require('supertest');
const express = require('express');

describe('routes/beatles', () => {
  let app;
  let router;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();

    router = require('../routes/beatles');

    app = express();
    app.use(express.json());
    app.use('/api', router);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/beatles/interview returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/beatles/interview')
      .send({ beatle: 'john' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Missing required fields: beatle and question'
    });
  });

  test('POST /api/beatles/interview returns FastAPI response on success', async () => {
    const mockPayload = {
      answer: 'It was a very creative time.'
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockPayload)
    });

    const res = await request(app)
      .post('/api/beatles/interview')
      .send({
        beatle: 'john',
        question: 'What was the mood in the studio?'
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockPayload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('POST /api/beatles/interview forwards FastAPI error status/details', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: jest.fn().mockResolvedValue({ detail: 'Invalid beatle' })
    });

    const res = await request(app)
      .post('/api/beatles/interview')
      .send({
        beatle: 'nobody',
        question: 'hello'
      });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: 'FastAPI request failed',
      details: { detail: 'Invalid beatle' }
    });
  });

  test('POST /api/beatles/interview returns 500 when fetch throws', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));

    const res = await request(app)
      .post('/api/beatles/interview')
      .send({
        beatle: 'paul',
        question: 'How did you write that song?'
      });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Internal server error',
      details: 'network down'
    });
  });
});
