// services/gradingService.js
const { DefaultAzureCredential } = require('@azure/identity');

const credential = new DefaultAzureCredential();

async function getGradingToken() {
  const audience = `api://${process.env.GRADING_SERVICE_CLIENT_ID}/.default`;
  const tokenResponse = await credential.getToken(audience);

  // TEMP DEBUG — decode the token payload (no signature verification, just inspection)
  const payloadB64 = tokenResponse.token.split('.')[1];
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
  console.log('[token debug] aud:', payload.aud);
  console.log('[token debug] appid:', payload.appid);
  console.log('[token debug] azp:', payload.azp);
  console.log('[token debug] roles:', payload.roles);
  console.log('[token debug] iss:', payload.iss);

  return tokenResponse.token;
}

async function callGradingService(payload) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[dev] Stubbing grading service call, payload:', payload);
    return {
      score: 85,
      feedback: 'This is a stubbed local response — grading service not called.',
    };
  }

  const token = await getGradingToken();
  const res = await fetch(process.env.GRADING_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Grading service returned ${res.status}: ${errorText}`);
  }

  return res.json();
}

module.exports = { callGradingService };