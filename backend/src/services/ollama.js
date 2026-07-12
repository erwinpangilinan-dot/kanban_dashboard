function isConfigured() {
  return Boolean(process.env.OLLAMA_MODEL);
}

function baseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

function connectionHint(err) {
  if (err?.cause?.code === 'ECONNREFUSED' || err?.code === 'ECONNREFUSED') {
    return `Cannot reach Ollama at ${baseUrl()}. Ensure Ollama is running and reachable from the API container.`;
  }
  if (err?.cause?.code === 'ENOTFOUND' || err?.code === 'ENOTFOUND') {
    return `Cannot resolve Ollama host (${baseUrl()}). Check OLLAMA_BASE_URL in .env.`;
  }
  return err?.message || 'Ollama request failed';
}

function extractJsonBlock(content) {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) return content.slice(start, end + 1);
  if (start >= 0) return content.slice(start);
  return content;
}

function repairJsonText(text) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  t = t.replace(/[\u201C\u201D]/g, '"');
  // "field": \"value\" → "field": "value"
  t = t.replace(
    /("(?:category|summary|reasoning|subject|body)")\s*:\s*\\"((?:[^"\\]|\\.)*)\\"?/g,
    '$1: "$2"'
  );
  t = t.replace(/,(\s*})/g, '$1');
  return t;
}

function parseJsonContent(content) {
  const candidates = [
    content,
    extractJsonBlock(content),
    repairJsonText(extractJsonBlock(content)),
  ];

  for (const text of candidates) {
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      // try next repair pass
    }
  }

  throw new Error(`Model returned invalid JSON: ${content.slice(0, 120)}`);
}

async function chat({ messages }) {
  const model = process.env.OLLAMA_MODEL;
  if (!model) {
    throw new Error('Ollama is not configured. Set OLLAMA_MODEL in .env.');
  }

  const timeout = Number(process.env.OLLAMA_TIMEOUT_MS) || 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        format: 'json',
        stream: false,
        think: false,
        options: { num_predict: 512 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.message?.content?.trim();
    if (!content) {
      const hint = data.done_reason === 'length'
        ? 'Model ran out of tokens.'
        : 'No content returned.';
      throw new Error(`Empty response from Ollama (${hint})`);
    }
    return content;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama timed out after ${timeout}ms`);
    }
    if (
      err.message?.startsWith('Ollama request failed')
      || err.message?.startsWith('Empty response')
    ) {
      throw err;
    }
    throw new Error(connectionHint(err));
  } finally {
    clearTimeout(timer);
  }
}

async function chatJson({ messages }) {
  return parseJsonContent(await chat({ messages }));
}

module.exports = {
  isConfigured,
  baseUrl,
  chat,
  repairJsonText,
  parseJsonContent,
  chatJson,
};
