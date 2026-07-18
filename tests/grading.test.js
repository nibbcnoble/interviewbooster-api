const request = require('supertest');
const express = require('express');

jest.mock('../services/gradingService', () => ({
  callGradingService: jest.fn()
}));

const { callGradingService } = require('../services/gradingService');

describe('routes/grading', () => {
  let app;
  let router;

  beforeEach(() => {
    jest.clearAllMocks();

    router = require('../routes/grading');

    app = express();
    app.use(express.json());
    app.use('/api', router);
  });

  test('POST /api/grade returns grading service result', async () => {
    const serviceResult = {
      score: 9,
      feedback: 'Strong answer'
    };

    callGradingService.mockResolvedValue(serviceResult);

    const payload = {
      question: 'What is Azure?',
      answer: 'A cloud platform'
    };

    const res = await request(app)
      .post('/api/grade')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serviceResult);
    expect(callGradingService).toHaveBeenCalledWith(payload);
  });

  test('POST /api/grade returns 502 when grading service fails', async () => {
    callGradingService.mockRejectedValue(new Error('service unavailable'));

    const res = await request(app)
      .post('/api/grade')
      .send({
        question: 'Q',
        answer: 'A'
      });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Grading service unavailable');
    expect(res.body.debug).toBe('service unavailable');
    expect(res.body.stack).toBeDefined();
  });
});
