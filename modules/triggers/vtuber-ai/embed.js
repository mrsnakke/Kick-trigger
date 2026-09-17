const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
const DEFAULT_DIMENSION = 768;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function vecToBytes(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function bytesToVec(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function createEmbedder({ apiKey, model = DEFAULT_MODEL, dimension = DEFAULT_DIMENSION } = {}) {
  if (!apiKey) return null;
  if (!model) model = DEFAULT_MODEL;

  const cache = new Map();
  const CACHE_MAX = 2048;

  function addCache(text, vec) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(text, vec);
  }

  async function embedSingle(text) {
    if (!text) return null;
    const cached = cache.get(text);
    if (cached) return cached;
    try {
      const res = await fetch(`${GEMINI_BASE}/v1beta/models/${model}:embedContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: dimension,
        }),
      });
      if (!res.ok) throw new Error(`Gemini embedding ${res.status}`);
      const data = await res.json();
      const values = data?.embedding?.values;
      if (!Array.isArray(values)) throw new Error('Gemini embedding: sin values');
      const vec = Float32Array.from(values);
      addCache(text, vec);
      return vec;
    } catch (e) {
      console.warn('[Embed] fallo embedding: ' + e.message);
      return null;
    }
  }

  async function embedBatch(texts) {
    const out = new Array(texts.length);
    const missing = [];
    texts.forEach((t, i) => {
      const c = t ? cache.get(t) : null;
      if (c) out[i] = c;
      else if (t) missing.push({ i, text: t });
    });
    if (missing.length) {
      try {
        const res = await fetch(`${GEMINI_BASE}/v1beta/models/${model}:batchEmbedContents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            requests: missing.map(({ text }) => ({ model: `models/${model}`, content: { parts: [{ text }] }, outputDimensionality: dimension })),
          }),
        });
        if (!res.ok) throw new Error(`Gemini batch ${res.status}`);
        const data = await res.json();
        (data?.embeddings || []).forEach((e, k) => {
          const v = Float32Array.from(e?.values || []);
          if (v.length && missing[k]) {
            out[missing[k].i] = v;
            addCache(missing[k].text, v);
          }
        });
      } catch (e) {
        console.warn('[Embed] fallo batch: ' + e.message);
      }
    }
    for (let i = 0; i < out.length; i++) {
      if (!out[i]) out[i] = await embedSingle(texts[i]);
    }
    return out;
  }

  return { enabled: true, model, dimension, embedSingle, embedBatch };
}

module.exports = { createEmbedder, cosine, vecToBytes, bytesToVec, DEFAULT_MODEL, DEFAULT_DIMENSION };