// Default to same-origin reverse proxy (`/openclaw/...`) so the browser never
// needs the bearer or hits CORS. nginx in front of this app injects auth.
const BASE = (import.meta.env.VITE_OPENCLAW_URL?.replace(/\/$/, '')) || '/openclaw';
const KEY = import.meta.env.VITE_OPENCLAW_KEY || '';
const MODEL = import.meta.env.VITE_OPENCLAW_MODEL || 'openclaw/main';
const OVERRIDE = import.meta.env.VITE_OPENCLAW_MODEL_OVERRIDE || '';
const SYSTEM = import.meta.env.VITE_SYSTEM_PROMPT
  || 'Eres Nex, asistente por voz. Responde corto, natural, conversacional, sin markdown, sin listas, sin emojis. Máximo 2-3 frases salvo que se pida más.';

const history = [];
const MAX_TURNS = 12;

export function resetHistory() { history.length = 0; }

async function postChat(messages, signal) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
    ...(OVERRIDE ? { 'x-openclaw-model': OVERRIDE } : {}),
    'x-openclaw-session-key': 'echoshow-call',
  };
  return fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ model: MODEL, messages, stream: true, max_tokens: 400 }),
  });
}

function transientStatus(s) { return s === 502 || s === 503 || s === 504 || s === 408 || s === 429; }

export async function streamReply(userText, { onDelta, onDone, signal } = {}) {
  history.push({ role: 'user', content: userText });
  const messages = [{ role: 'system', content: SYSTEM }, ...history.slice(-MAX_TURNS)];

  // Retry up to 3 times on transient errors. Cloudflare 502 happens when openclaw
  // takes a moment to start streaming; backoff usually fixes it.
  let res;
  const delays = [0, 700, 1500];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(r => setTimeout(r, delays[attempt]));
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    try {
      res = await postChat(messages, signal);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt === delays.length - 1) throw new Error('Sin conexión');
      continue;
    }
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      // Reject HTML responses pretending to be 200 (Cloudflare error pages can do this).
      if (!ct.includes('event-stream') && !ct.includes('json')) {
        if (attempt === delays.length - 1) throw new Error('Servicio no disponible');
        continue;
      }
      break;
    }
    if (!transientStatus(res.status)) {
      throw new Error(`Servicio no disponible (${res.status})`);
    }
  }
  if (!res?.ok || !res.body) {
    throw new Error('Servicio no disponible');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content || '';
        if (delta) { full += delta; onDelta?.(delta, full); }
      } catch {}
    }
  }

  if (full) history.push({ role: 'assistant', content: full });
  onDone?.(full);
  return full;
}
