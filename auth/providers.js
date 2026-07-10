

// [BACKEND — Express repo] — auth/providers.js
const client = require('openid-client');
 
let msConfig;
let googleConfig;
 
async function initProviders() {
  msConfig = await client.discovery(
    new URL(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/v2.0`),
    process.env.MS_CLIENT_ID,
    process.env.MS_CLIENT_SECRET
  );
 
  googleConfig = await client.discovery(
    new URL('https://accounts.google.com'),
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
}
 
function getConfig(provider) {
  if (provider === 'microsoft') return msConfig;
  if (provider === 'google') return googleConfig;
  throw new Error(`Unknown provider: ${provider}`);
}
 
module.exports = { initProviders, getConfig };
 