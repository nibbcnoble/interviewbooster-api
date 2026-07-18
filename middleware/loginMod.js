const crypto = require('crypto');

const SECRET = process.env.EMAIL_ENCRYPTION_KEY;

if (!SECRET) {
  throw new Error('EMAIL_ENCRYPTION_KEY is required');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Deterministically derives a stable, non-reversible token from an email.
 * This is appropriate for identity lookup keys that must be consistent
 * across devices/logins without storing plaintext email.
 */
function encryptEmail(email) {
  const normalized = normalizeEmail(email);

  return crypto
    .createHmac('sha256', SECRET)
    .update(normalized)
    .digest('hex');
}

/**
 * Not reversible by design.
 * Kept only to fail loudly if something still expects decryption.
 */
function decryptEmail() {
  throw new Error('decryptEmail is not supported: deterministic email tokens are non-reversible.');
}

module.exports = { encryptEmail, decryptEmail };
