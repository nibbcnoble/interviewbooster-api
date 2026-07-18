const express = require('express');
const router = express.Router();
const { getDb } = require('../middleware/mongo');

const TICKER_PATTERN = /^[A-Z.]{1,10}$/;
const MAX_SYMBOLS_PER_USER = 25;
const TIME_SERIES_OPTIONS = ['1D', '5D', '1M', '6M', '1Y', '5Y', 'MAX'];
const CHAT_CATEGORY_OPTIONS = ['user', 'answer', 'insight'];

function normalizeSymbol(symbol) {
  return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
}

function requireEnc(req, res) {
  const enc = req.user?.enc;
  if (!enc) {
    res.status(401).json({ error: 'Unauthenticated' });
    return null;
  }
  return enc;
}

function sanitizeChatMessage(message) {
  if (!message || typeof message !== 'object') return null;

  const category =
    typeof message.category === 'string' ? message.category.trim().toLowerCase() : '';
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const timestamp = message.timestamp ? new Date(message.timestamp) : new Date();

  if (!CHAT_CATEGORY_OPTIONS.includes(category)) return null;
  if (!text) return null;
  if (Number.isNaN(timestamp.getTime())) return null;

  return {
    category,
    text,
    timestamp: timestamp.toISOString(),
  };
}

function parseMarketNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sliceSeriesByRange(series, range) {
  if (!Array.isArray(series) || !series.length) return [];

  const latest = new Date(series[series.length - 1].time);
  const cutoff = new Date(latest);

  switch (range) {
    case '1D':
      cutoff.setDate(cutoff.getDate() - 1);
      break;
    case '5D':
      cutoff.setDate(cutoff.getDate() - 5);
      break;
    case '1M':
      cutoff.setMonth(cutoff.getMonth() - 1);
      break;
    case '6M':
      cutoff.setMonth(cutoff.getMonth() - 6);
      break;
    case '1Y':
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      break;
    case '5Y':
      cutoff.setFullYear(cutoff.getFullYear() - 5);
      break;
    case 'MAX':
    default:
      return series;
  }

  return series.filter((point) => new Date(point.time) >= cutoff);
}

function summarizeSeries(series) {
  if (!Array.isArray(series) || !series.length) {
    return {
      currentPrice: null,
      priceChange: null,
      priceChangePercent: null,
    };
  }

  const first = series[0]?.value ?? null;
  const last = series[series.length - 1]?.value ?? null;

  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return {
      currentPrice: null,
      priceChange: null,
      priceChangePercent: null,
    };
  }

  const priceChange = last - first;
  const priceChangePercent = first === 0 ? 0 : (priceChange / first) * 100;

  return {
    currentPrice: last,
    priceChange,
    priceChangePercent,
  };
}

function getTwelveDataConfigForRange(range) {
  switch (range) {
    case '1D':
      return { interval: '5min', outputsize: 100 };
    case '5D':
      return { interval: '1h', outputsize: 120 };
    case '1M':
      return { interval: '1day', outputsize: 40 };
    case '6M':
      return { interval: '1day', outputsize: 200 };
    case '1Y':
      return { interval: '1day', outputsize: 260 };
    case '5Y':
      return { interval: '1week', outputsize: 300 };
    case 'MAX':
      return { interval: '1month', outputsize: 500 };
    default:
      return { interval: '1day', outputsize: 100 };
  }
}

async function callTwelveDataTimeSeries(symbol, range) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    const err = new Error('Missing Twelve Data API key.');
    err.statusCode = 500;
    throw err;
  }

  const { interval, outputsize } = getTwelveDataConfigForRange(range);

  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', String(outputsize));
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('apikey', apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const err = new Error(`Twelve Data request failed with status ${response.status}.`);
    err.statusCode = 502;
    throw err;
  }

  const data = await response.json();

  if (data.status === 'error') {
    const err = new Error(data.message || 'Twelve Data error.');
    err.statusCode = data.code === 429 ? 429 : 502;
    throw err;
  }

  if (!Array.isArray(data.values)) {
    const err = new Error('Twelve Data returned no time series values.');
    err.statusCode = 502;
    throw err;
  }

  return {
    interval,
    values: data.values,
    meta: data.meta || {},
  };
}

function normalizeTwelveDataPointTime(datetime) {
  if (typeof datetime !== 'string') return null;

  if (datetime.includes(' ')) {
    const millis = new Date(datetime.replace(' ', 'T') + 'Z').getTime();
    if (!Number.isFinite(millis)) return null;
    return Math.floor(millis / 1000);
  }

  const dateOnly = datetime.trim();
  if (!dateOnly) return null;
  return dateOnly;
}

function normalizeTwelveDataSeries(values) {
  return values
    .map((point) => ({
      time: normalizeTwelveDataPointTime(point.datetime),
      value: parseMarketNumber(point.close),
    }))
    .filter((point) => point.time !== null && point.value !== null)
    .sort((a, b) => {
      const aTime = typeof a.time === 'number' ? a.time * 1000 : new Date(a.time).getTime();
      const bTime = typeof b.time === 'number' ? b.time * 1000 : new Date(b.time).getTime();
      return aTime - bTime;
    });
}

async function fetchTwelveDataSeries(symbol, range) {
  const result = await callTwelveDataTimeSeries(symbol, range);
  const rawSeries = normalizeTwelveDataSeries(result.values);

  if (!rawSeries.length) {
    const err = new Error('No usable market data returned from Twelve Data.');
    err.statusCode = 502;
    throw err;
  }

  const series = sliceSeriesByRange(rawSeries, range);
  const summary = summarizeSeries(series.length ? series : rawSeries);

  return {
    range,
    interval: result.interval,
    source: 'twelvedata',
    series: series.length ? series : rawSeries,
    ...summary,
  };
}

// GET /api/stocks
router.get('/stocks', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const db = getDb();
    const records = db.collection('stockRecords');

    const docs = await records
      .find({ enc }, { projection: { _id: 0, symbol: 1 } })
      .sort({ symbol: 1 })
      .toArray();

    res.json({
      ok: true,
      symbols: docs.map((doc) => doc.symbol),
    });
  } catch (err) {
    console.error('GET /api/stocks error', err);
    res.status(500).json({ error: 'Failed to load stock list.' });
  }
});

// GET /api/stocks/:symbol
router.get('/stocks/:symbol', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol || !TICKER_PATTERN.test(symbol)) {
      return res.status(400).json({ error: 'A valid stock ticker symbol is required.' });
    }

    const db = getDb();
    const records = db.collection('stockRecords');

    const stock = await records.findOne(
      { enc, symbol },
      {
        projection: {
          _id: 0,
          enc: 0,
        },
      }
    );

    if (!stock) {
      return res.status(404).json({ error: 'Stock not found for this user.' });
    }

    res.json({
      ok: true,
      stock,
    });
  } catch (err) {
    console.error('GET /api/stocks/:symbol error', err);
    res.status(500).json({ error: 'Failed to load stock record.' });
  }
});

// GET /api/stocks/:symbol/market-data
router.get('/stocks/:symbol/market-data', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol || !TICKER_PATTERN.test(symbol)) {
      return res.status(400).json({ error: 'A valid stock ticker symbol is required.' });
    }

    const db = getDb();
    const records = db.collection('stockRecords');

    const stock = await records.findOne(
      { enc, symbol },
      { projection: { _id: 0, symbol: 1, timeSeries: 1 } }
    );

    if (!stock) {
      return res.status(404).json({ error: 'Stock not found for this user.' });
    }

    const requestedRange =
      typeof req.query.range === 'string' ? req.query.range.trim().toUpperCase() : '';
    const range = requestedRange || stock.timeSeries || '1M';

    if (!TIME_SERIES_OPTIONS.includes(range)) {
      return res.status(400).json({ error: 'A valid time series range is required.' });
    }

    const marketData = await fetchTwelveDataSeries(symbol, range);

    res.json({
      ok: true,
      symbol,
      range,
      source: marketData.source,
      interval: marketData.interval,
      series: marketData.series,
      currentPrice: marketData.currentPrice,
      priceChange: marketData.priceChange,
      priceChangePercent: marketData.priceChangePercent,
    });
  } catch (err) {
    console.error('GET /api/stocks/:symbol/market-data error', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to load market data.',
    });
  }
});

// POST /api/stocks/add
router.post('/stocks/add', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const symbol = normalizeSymbol(req.body?.symbol);
    if (!symbol || !TICKER_PATTERN.test(symbol)) {
      return res.status(400).json({ error: 'A valid stock ticker symbol is required.' });
    }

    const db = getDb();
    const records = db.collection('stockRecords');

    const existing = await records.findOne({ enc, symbol });
    if (existing) {
      const symbols = await records
        .find({ enc }, { projection: { _id: 0, symbol: 1 } })
        .sort({ symbol: 1 })
        .toArray();

      return res.json({
        ok: true,
        symbols: symbols.map((doc) => doc.symbol),
        message: `${symbol} is already on your list.`,
      });
    }

    const count = await records.countDocuments({ enc });
    if (count >= MAX_SYMBOLS_PER_USER) {
      return res.status(400).json({ error: `You can track at most ${MAX_SYMBOLS_PER_USER} stocks.` });
    }

    const now = new Date();

    await records.insertOne({
      enc,
      symbol,
      timeSeries: '1M',
      chatHistory: [],
      createdAt: now,
      updatedAt: now,
    });

    const symbols = await records
      .find({ enc }, { projection: { _id: 0, symbol: 1 } })
      .sort({ symbol: 1 })
      .toArray();

    res.status(201).json({
      ok: true,
      symbols: symbols.map((doc) => doc.symbol),
      message: `${symbol} added to your list.`,
    });
  } catch (err) {
    console.error('POST /api/stocks/add error', err);
    res.status(500).json({ error: 'Failed to add stock.' });
  }
});

// DELETE /api/stocks/remove/:symbol
router.delete('/stocks/remove/:symbol', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol || !TICKER_PATTERN.test(symbol)) {
      return res.status(400).json({ error: 'A valid stock ticker symbol is required.' });
    }

    const db = getDb();
    const records = db.collection('stockRecords');

    const result = await records.deleteOne({ enc, symbol });
    if (!result.deletedCount) {
      return res.status(404).json({ error: 'Stock not found for this user.' });
    }

    const symbols = await records
      .find({ enc }, { projection: { _id: 0, symbol: 1 } })
      .sort({ symbol: 1 })
      .toArray();

    res.json({
      ok: true,
      symbols: symbols.map((doc) => doc.symbol),
      message: `${symbol} removed from your list.`,
    });
  } catch (err) {
    console.error('DELETE /api/stocks/remove error', err);
    res.status(500).json({ error: 'Failed to remove stock.' });
  }
});

// PATCH /api/stocks/:symbol/timeseries
router.patch('/stocks/:symbol/timeseries', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const symbol = normalizeSymbol(req.params.symbol);
    const range = typeof req.body?.range === 'string' ? req.body.range.trim().toUpperCase() : '';

    if (!symbol || !TICKER_PATTERN.test(symbol)) {
      return res.status(400).json({ error: 'A valid stock ticker symbol is required.' });
    }

    if (!TIME_SERIES_OPTIONS.includes(range)) {
      return res.status(400).json({ error: 'A valid time series range is required.' });
    }

    const db = getDb();
    const records = db.collection('stockRecords');
    const now = new Date();

    const stock = await records.findOneAndUpdate(
      { enc, symbol },
      { $set: { timeSeries: range, updatedAt: now } },
      {
        returnDocument: 'after',
        projection: { _id: 0, enc: 0 },
      }
    );

    if (!stock) {
      return res.status(404).json({ error: 'Stock not found for this user.' });
    }

    res.json({
      ok: true,
      stock,
      message: `${symbol} time series updated to ${range}.`,
    });
  } catch (err) {
    console.error('PATCH /api/stocks/:symbol/timeseries error', err);
    res.status(500).json({ error: 'Failed to update time series.' });
  }
});

// PATCH /api/stocks/:symbol/chat
router.patch('/stocks/:symbol/chat', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const symbol = normalizeSymbol(req.params.symbol);
    const incoming = req.body?.chatHistory;

    if (!symbol || !TICKER_PATTERN.test(symbol)) {
      return res.status(400).json({ error: 'A valid stock ticker symbol is required.' });
    }

    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: 'chatHistory must be an array.' });
    }

    const chatHistory = incoming
      .map(sanitizeChatMessage)
      .filter(Boolean);

    const db = getDb();
    const records = db.collection('stockRecords');
    const now = new Date();

    const stock = await records.findOneAndUpdate(
      { enc, symbol },
      { $set: { chatHistory, updatedAt: now } },
      {
        returnDocument: 'after',
        projection: { _id: 0, enc: 0, chatHistory: 1, symbol: 1, timeSeries: 1, updatedAt: 1 },
      }
    );

    if (!stock) {
      return res.status(404).json({ error: 'Stock not found for this user.' });
    }

    res.json({
      ok: true,
      stock,
      message: `${symbol} chat history updated.`,
    });
  } catch (err) {
    console.error('PATCH /api/stocks/:symbol/chat error', err);
    res.status(500).json({ error: 'Failed to update chat history.' });
  }
});

router.post('/stocks/:symbol/chat/messages', async (req, res) => {
  try {
    const enc = requireEnc(req, res);
    if (!enc) return;

    const symbol = normalizeSymbol(req.params.symbol);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

    if (!symbol || !TICKER_PATTERN.test(symbol)) {
      return res.status(400).json({ error: 'A valid stock ticker symbol is required.' });
    }

    if (!text) {
      return res.status(400).json({ error: 'Message text is required.' });
    }

    const now = new Date();
    const userMessage = {
      category: 'user',
      text,
      timestamp: now.toISOString(),
    };

    const answerMessage = {
      category: 'answer',
      text: `Stub response for "${text}". A backend AI service will eventually replace this stub.`,
      timestamp: new Date(now.getTime() + 1).toISOString(),
    };

    const db = getDb();
    const records = db.collection('stockRecords');

    const stock = await records.findOneAndUpdate(
      { enc, symbol },
      {
        $push: {
          chatHistory: {
            $each: [userMessage, answerMessage],
          },
        },
        $set: { updatedAt: new Date() },
      },
      {
        returnDocument: 'after',
        projection: { _id: 0, enc: 0 },
      }
    );

    if (!stock) {
      return res.status(404).json({ error: 'Stock not found for this user.' });
    }

    res.status(201).json({
      ok: true,
      stock,
    });
  } catch (err) {
    console.error('POST /api/stocks/:symbol/chat/messages error', err);
    res.status(500).json({ error: 'Failed to process chat message.' });
  }
});

module.exports = router;
