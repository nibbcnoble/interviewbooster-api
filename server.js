const express = require('express');
require('dotenv').config();
const cors = require('cors');
const session = require('express-session');
const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');


const app = express();
const PORT = process.env.PORT || 8080; // App Service injects PORT

const redisClient = createClient({
  username: 'default',
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT)
  }
});

redisClient.on('error', err => console.log('Redis Client Error', err));

async function start() {
  await redisClient.connect();

  app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // true in prod (HTTPS), false for local http dev
      httpOnly: true,
      maxAge: 14 * 24 * 60 * 60 * 1000
    }
  }));

  /*
  app.use(cors({
    origin: 'https://wonderful-wave-025108c1e.7.azurestaticapps.net'
  }));
  */
  app.use(cors());
  app.use(express.json());

  app.get('/api/hello', (req, res) => {
    res.json({ message: 'Communication verified. Application API is accessible.' });
  });

  app.get('/api/ping', (req, res) => res.send('api-prefix-preserved'));
  app.get('/ping', (req, res) => res.send('api-prefix-stripped'));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const gradingRoutes = require('./routes/grading');
  app.use('/api', gradingRoutes);

  app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});