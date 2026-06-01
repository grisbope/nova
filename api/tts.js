export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': req.headers['content-type'] || 'application/json',
      Accept: req.headers.accept || 'audio/mpeg',
    },
    body,
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    res.status(upstream.status).send(text);
    return;
  }

  const audio = Buffer.from(await upstream.arrayBuffer());
  res.status(200);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
  res.send(audio);
}
