export const config = { api: { bodyParser: false } };

const SKIP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'transfer-encoding',
]);

export default async function handler(req, res) {
  const segments = req.query.path || [];
  const path = Array.isArray(segments) ? segments.join('/') : String(segments);
  const upstreamBase = (process.env.OPENCLAW_UPSTREAM || 'https://openclaw.grisbope.com').replace(/\/$/, '');
  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const url = `${upstreamBase}/${path}${query}`;

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || SKIP_HEADERS.has(key.toLowerCase())) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  headers.authorization = `Bearer ${process.env.OPENCLAW_KEY || ''}`;

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
