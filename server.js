const express = require('express');
require('dotenv').config();
const helmet = require('helmet');
const session = require('express-session');
const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');

const { initProviders } = require('./auth/providers');
const requireAuth = require('./middleware/requireAuth');



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

  // openid-client discovery does a network round-trip to each provider's
  // /.well-known endpoint — must resolve before auth routes can work
  await initProviders();

  app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // true in prod (HTTPS), false for local http dev
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 14 * 24 * 60 * 60 * 1000
    }
  }));

  // CORS removed — with the Vite proxy locally and the SWA linked backend in
  // prod, every /api/* request is same-origin from the browser's point of
  // view. No cross-origin requests means no CORS config needed, and it's one
  // less thing to get wrong alongside session cookies. If that assumption
  // ever changes (e.g. a separate domain calling this API directly), add
  // cors({ origin: process.env.BASE_URL, credentials: true }) back in.
  app.use(express.json());

  app.get('/api/hello', (req, res) => {
    res.json({ message: 'Communication verified. Application API is accessible.' });
  });

  app.get('/api/ping', (req, res) => res.send('api-prefix-preserved'));
  app.get('/ping', (req, res) => res.send('api-prefix-stripped'));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Auth routes — must be mounted BEFORE the requireAuth gate below,
  // since /login and /callback have to stay reachable while unauthenticated
  const authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);

  // Everything below this line requires a valid session.
  // helmet is scoped to /api rather than global since there's no HTML
  // being served here (that's the React app's job).
  app.use('/api', helmet());
  app.use('/api', requireAuth);

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
