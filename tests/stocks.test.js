const request = require('supertest');
const express = require('express');

const getDb = jest.fn();

jest.mock('../middleware/mongo', () => ({
  getDb
}));

describe('routes/stocks', () => {
  let app;
  let recordsCollection;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    global.fetch = jest.fn();

    recordsCollection = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      insertOne: jest.fn(),
      deleteOne: jest.fn(),
      findOneAndUpdate: jest.fn()
    };

    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'stockRecords') return recordsCollection;
        throw new Error(`Unexpected collection: ${name}`);
      })
    });

    const router = require('../routes/stocks');

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { enc: 'user-123' };
      next();
    });
    app.use('/api', router);
  });

  test('GET /api/stocks returns user symbols', async () => {
    const toArray = jest.fn().mockResolvedValue([
      { symbol: 'AAPL' },
      { symbol: 'MSFT' }
    ]);
    const sort = jest.fn().mockReturnValue({ toArray });
    recordsCollection.find.mockReturnValue({ sort });

    const res = await request(app).get('/api/stocks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      symbols: ['AAPL', 'MSFT']
    });
  });

  test('GET /api/stocks/:symbol returns 400 for invalid symbol', async () => {
    const res = await request(app).get('/api/stocks/bad-symbol!');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'A valid stock ticker symbol is required.'
    });
  });

  test('GET /api/stocks/:symbol returns 404 when stock is not found', async () => {
    recordsCollection.findOne.mockResolvedValue(null);

    const res = await request(app).get('/api/stocks/AAPL');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'Stock not found for this user.'
    });
  });

  test('GET /api/stocks/:symbol returns stock data', async () => {
    recordsCollection.findOne.mockResolvedValue({
      symbol: 'AAPL',
      timeSeries: '1M',
      chatHistory: []
    });

    const res = await request(app).get('/api/stocks/AAPL');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      stock: {
        symbol: 'AAPL',
        timeSeries: '1M',
        chatHistory: []
      }
    });
  });

  test('POST /api/stocks/add returns 400 for invalid symbol', async () => {
    const res = await request(app)
      .post('/api/stocks/add')
      .send({ symbol: 'bad-symbol!' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'A valid stock ticker symbol is required.'
    });
  });

  test('POST /api/stocks/add returns existing symbols when symbol already exists', async () => {
    recordsCollection.findOne.mockResolvedValue({ enc: 'user-123', symbol: 'AAPL' });

    const toArray = jest.fn().mockResolvedValue([{ symbol: 'AAPL' }]);
    const sort = jest.fn().mockReturnValue({ toArray });
    recordsCollection.find.mockReturnValue({ sort });

    const res = await request(app)
      .post('/api/stocks/add')
      .send({ symbol: 'aapl' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      symbols: ['AAPL'],
      message: 'AAPL is already on your list.'
    });
  });

  test('POST /api/stocks/add creates a new stock record', async () => {
    recordsCollection.findOne.mockResolvedValue(null);
    recordsCollection.countDocuments.mockResolvedValue(0);
    recordsCollection.insertOne.mockResolvedValue({ acknowledged: true });

    const toArray = jest.fn().mockResolvedValue([{ symbol: 'AAPL' }]);
    const sort = jest.fn().mockReturnValue({ toArray });
    recordsCollection.find.mockReturnValue({ sort });

    const res = await request(app)
      .post('/api/stocks/add')
      .send({ symbol: 'aapl' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      symbols: ['AAPL'],
      message: 'AAPL added to your list.'
    });
    expect(recordsCollection.insertOne).toHaveBeenCalled();
  });

  test('DELETE /api/stocks/remove/:symbol returns 404 when stock does not exist', async () => {
    recordsCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });

    const res = await request(app).delete('/api/stocks/remove/AAPL');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'Stock not found for this user.'
    });
  });

  test('DELETE /api/stocks/remove/:symbol removes a stock', async () => {
    recordsCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const toArray = jest.fn().mockResolvedValue([{ symbol: 'MSFT' }]);
    const sort = jest.fn().mockReturnValue({ toArray });
    recordsCollection.find.mockReturnValue({ sort });

    const res = await request(app).delete('/api/stocks/remove/AAPL');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      symbols: ['MSFT'],
      message: 'AAPL removed from your list.'
    });
  });

  test('PATCH /api/stocks/:symbol/timeseries returns 400 for invalid range', async () => {
    const res = await request(app)
      .patch('/api/stocks/AAPL/timeseries')
      .send({ range: '10Y' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'A valid time series range is required.'
    });
  });

  test('PATCH /api/stocks/:symbol/timeseries updates range', async () => {
    recordsCollection.findOneAndUpdate.mockResolvedValue({
      symbol: 'AAPL',
      timeSeries: '1Y'
    });

    const res = await request(app)
      .patch('/api/stocks/AAPL/timeseries')
      .send({ range: '1Y' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      stock: {
        symbol: 'AAPL',
        timeSeries: '1Y'
      },
      message: 'AAPL time series updated to 1Y.'
    });
  });

  test('PATCH /api/stocks/:symbol/chat returns 400 when chatHistory is not an array', async () => {
    const res = await request(app)
      .patch('/api/stocks/AAPL/chat')
      .send({ chatHistory: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'chatHistory must be an array.'
    });
  });

  test('PATCH /api/stocks/:symbol/chat updates chat history', async () => {
    recordsCollection.findOneAndUpdate.mockResolvedValue({
      symbol: 'AAPL',
      timeSeries: '1M',
      updatedAt: '2024-01-01T00:00:00.000Z',
      chatHistory: [
        {
          category: 'user',
          text: 'hello',
          timestamp: '2024-01-01T00:00:00.000Z'
        }
      ]
    });

    const res = await request(app)
      .patch('/api/stocks/AAPL/chat')
      .send({
        chatHistory: [
          {
            category: 'user',
            text: ' hello ',
            timestamp: '2024-01-01T00:00:00.000Z'
          }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('AAPL chat history updated.');
    expect(res.body.stock).toEqual({
      symbol: 'AAPL',
      timeSeries: '1M',
      updatedAt: '2024-01-01T00:00:00.000Z',
      chatHistory: [
        {
          category: 'user',
          text: 'hello',
          timestamp: '2024-01-01T00:00:00.000Z'
        }
      ]
    });
    expect(recordsCollection.findOneAndUpdate).toHaveBeenCalled();
  });

  test('POST /api/stocks/:symbol/chat/messages returns 400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/stocks/AAPL/chat/messages')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Message text is required.'
    });
  });

  test('POST /api/stocks/:symbol/chat/messages appends messages', async () => {
    recordsCollection.findOneAndUpdate.mockResolvedValue({
      symbol: 'AAPL',
      chatHistory: [
        { category: 'user', text: 'How is AAPL?', timestamp: '2024-01-01T00:00:00.000Z' },
        { category: 'answer', text: 'Stub response', timestamp: '2024-01-01T00:00:00.001Z' }
      ]
    });

    const res = await request(app)
      .post('/api/stocks/AAPL/chat/messages')
      .send({ text: 'How is AAPL?' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.stock.symbol).toBe('AAPL');
    expect(recordsCollection.findOneAndUpdate).toHaveBeenCalled();
  });

  test('returns 401 when req.user.enc is missing', async () => {
    const router = require('../routes/stocks');
    const unauthApp = express();

    unauthApp.use(express.json());
    unauthApp.use((req, res, next) => {
      req.user = {};
      next();
    });
    unauthApp.use('/api', router);

    const res = await request(unauthApp).get('/api/stocks');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthenticated' });
  });
});
