const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

// Must be a 32-byte key, e.g. generated once via:
//   crypto.randomBytes(32).toString('hex')
// and stored as an env var (never hardcoded/committed).
const SECRET_KEY = Buffer.from(process.env.EMAIL_ENCRYPTION_KEY, 'hex');

/**
 * Encrypts an email address into a URL-safe token.
 */
function encryptEmail(email) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(email.trim().toLowerCase(), 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Pack iv + authTag + ciphertext together, then base64url-encode
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return payload.toString('base64url'); // URL-safe, no manual replace needed
}

/**
 * Decrypts a token back into the original email address.
 * Throws if the token is malformed or has been tampered with.
 */
function decryptEmail(token) {
  const payload = Buffer.from(token, 'base64url');

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = payload.subarray(IV_LENGTH + 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

module.exports = { encryptEmail, decryptEmail };