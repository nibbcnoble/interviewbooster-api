// services/gradingService.js
const { DefaultAzureCredential } = require('@azure/identity');

const credential = new DefaultAzureCredential();

async function getGradingToken() {
  const audience = `api://${process.env.GRADING_SERVICE_CLIENT_ID}/.default`;
  const tokenResponse = await credential.getToken(audience);
  return tokenResponse.token;
}

async function callGradingService(payload) {
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