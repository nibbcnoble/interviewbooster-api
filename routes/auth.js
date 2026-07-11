// [BACKEND — Express repo] — routes/auth.js
const { Router } = require('express');
const client = require('openid-client');
const { getConfig } = require('../auth/providers');

const router = Router();

router.get('/login/:provider', async (req, res) => {
  const { provider } = req.params;
  if (provider !== 'microsoft' && provider !== 'google') {
    return res.status(404).json({ error: 'unknown provider' });
  }

  const config = getConfig(provider);
  const code_verifier = client.randomPKCECodeVerifier();
  const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  req.session.oauthState = { provider, code_verifier, state, nonce };

  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: `${process.env.BASE_URL}/api/auth/callback/${provider}`,
    scope: 'openid profile email',
    code_challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  req.session.save((err) => {
    if (err) {
      console.error('Session save failed before OAuth redirect:', err);
      return res.status(500).send('Failed to start login');
    }
    res.redirect(authUrl.href);
  });
});

router.get('/callback/:provider', async (req, res) => {
  const { provider } = req.params;
  const saved = req.session.oauthState;

  if (!saved || saved.provider !== provider) {
    return res.status(400).send('OAuth state missing or mismatched — start login again.');
  }

  try {
    const config = getConfig(provider);
    const currentUrl = new URL(req.originalUrl, process.env.BASE_URL);

    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: saved.code_verifier,
      expectedState: saved.state,
      expectedNonce: saved.nonce,
    });

    const claims = tokens.claims();

    req.session.user = {
      id: claims.sub,
      email: claims.email ?? claims.preferred_username ?? null,
      name: claims.name ?? null,
      provider,
    };

    delete req.session.oauthState;
    res.redirect(process.env.BASE_URL);
  } catch (err) {
    console.error(`OAuth callback failed for ${provider}:`, err);
    delete req.session.oauthState;
    res.status(401).send('Authentication failed.');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy failed:', err);
      return res.status(500).json({ error: 'logout failed' });
    }
    res.clearCookie('connect.sid');
    res.status(204).end();
  });
});

router.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'unauthenticated' });
  res.json(req.session.user);
});

module.exports = router;