const DEFAULT_URL = 'http://10.10.50.2:8765';

function memoriaBases() {
  const bases = [];
  if (process.env.MEMORIA_API_URL) bases.push(process.env.MEMORIA_API_URL);
  bases.push(DEFAULT_URL);
  bases.push('http://host.docker.internal:8765');
  bases.push('http://127.0.0.1:8765');
  return [...new Set(bases.map((b) => b.replace(/\/$/, '')))];
}

async function memoriaFetch(path, options = {}) {
  let lastError = null;
  for (const base of memoriaBases()) {
    try {
      const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
      const res = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(options.timeoutMs || 15000),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        lastError = new Error(data?.error || data?.message || `HTTP ${res.status}`);
        continue;
      }
      return { base, data };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Memoria service unavailable');
}

async function remember(
  content,
  { memory_type = 'semantic', importance = 'high', force = true, infer_entities = true } = {}
) {
  return memoriaFetch('/remember', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, memory_type, importance, force, infer_entities }),
  });
}

async function recall(query, limit = 8) {
  const q = encodeURIComponent(query);
  return memoriaFetch(`/recall?q=${q}&limit=${limit}`);
}

module.exports = {
  memoriaBases,
  memoriaFetch,
  remember,
  recall,
  DEFAULT_URL,
};
