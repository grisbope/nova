export const config = { api: { bodyParser: false } };

const SKIP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'transfer-encoding',
]);

function resolvePath(req) {
  const raw = req.query?.path;
  if (raw) return Array.isArray(raw) ? raw.join('/') : String(raw);

  const url = req.url || '';
  const qIndex = url.indexOf('?');
  if (qIndex !== -1) {
    const params = new URLSearchParams(url.slice(qIndex + 1));
    const fromQuery = params.get('path');
    if (fromQuery) return fromQuery;
  }

  const pathname = qIndex === -1 ? url : url.slice(0, qIndex);
  const prefix = '/api/openclaw/';
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  return '';
}

export default async function handler(req, res) {
  const path = resolvePath(req).replace(/^\/+/, '');
  const upstreamBase = (process.env.OPENCLAW_UPSTREAM || 'https://openclaw.grisbope.com').replace(/\/$/, '');
  const url = path ? `${upstreamBase}/${path}` : upstreamBase;

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || SKIP_HEADERS.has(key.toLowerCase())) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  headers.authorization = `Bearer ${process.env.OPENCLAW_KEY || ''}`;
  headers.host = new URL(upstreamBase).host;

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const upstream = await fetch(url, { method: req.method, headers, body });
  res.status(upstream.status);

  upstream.headers.forEach((value, key) => {
    if (!SKIP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}
