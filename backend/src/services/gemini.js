const db = require('../db');

async function getApiKey() {
  try {
    const { rows } = await db.query(
      "SELECT value FROM workspace_settings WHERE key = 'gemini_api_key'"
    );
    if (rows.length && rows[0].value) return rows[0].value;
  } catch (err) {
    // Settings table might not be migrated yet in quick startup tests
  }
  return process.env.GEMINI_API_KEY || '';
}

async function isConfigured() {
  const key = await getApiKey();
  return Boolean(key);
}

function getModel() {
  return process.env.GEMINI_MODEL || 'gemini-1.5-flash';
}

async function chat({ messages }) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Set GEMINI_API_KEY in .env or settings.');
  }

  const model = getModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs = messages.filter(m => m.role !== 'system');

  const contents = userMsgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const payload = {
    contents,
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };

  if (systemMsg) {
    payload.systemInstruction = {
      parts: [{ text: systemMsg.content }]
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  return text;
}

module.exports = {
  isConfigured,
  chat,
  getApiKey
};
