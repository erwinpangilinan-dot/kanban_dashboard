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

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(`Model returned invalid JSON: ${content.slice(0, 120)}`);
  }
}

async function chatJson({ messages }) {
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
        options: { num_predict: 1024 },
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
    return parseJsonContent(content);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama timed out after ${timeout}ms`);
    }
    if (
      err.message?.startsWith('Ollama request failed')
      || err.message?.startsWith('Empty response')
      || err.message?.startsWith('Model returned invalid JSON')
    ) {
      throw err;
    }
    throw new Error(connectionHint(err));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isConfigured,
  baseUrl,
  chatJson,
};
