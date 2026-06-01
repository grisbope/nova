// Local JWT-ish session cache. Browser-only HMAC token, valid 3 months.
// This is not a real auth boundary; OpenClaw bearer is the actual security.
// It just keeps the PIN from being re-typed on every reboot of the Echo Show.

const SECRET = (import.meta.env.VITE_AUTH_SECRET || 'nex-echoshow-7c4e1b').slice(0, 64);
const PIN = String(import.meta.env.VITE_LOGIN_PIN || '123456');
const TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 days
const STORE_KEY = 'nex.auth.v1';

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = (s) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (p.length % 4)) % 4);
  return Uint8Array.from(atob(p + pad), c => c.charCodeAt(0));
};

async function hmac(payload) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
  return key;
}

async function sign(payloadObj) {
  const header = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify(payloadObj)));
  const data = `${header}.${body}`;
  const key = await hmac();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${b64u(sig)}`;
}

async function verify(token) {
  if (!token || token.split('.').length !== 3) return null;
  const [h, b, s] = token.split('.');
  const key = await hmac();
  const ok = await crypto.subtle.verify('HMAC', key, b64uDec(s), enc.encode(`${h}.${b}`));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64uDec(b)));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

export async function login(pin) {
  if (String(pin) !== PIN) return { ok: false, error: 'PIN incorrecto' };
  const payload = { sub: 'nex', iat: Date.now(), exp: Date.now() + TTL_MS };
  const token = await sign(payload);
  try { localStorage.setItem(STORE_KEY, token); } catch {}
  return { ok: true, token };
}

export async function checkSession() {
  let token = null;
  try { token = localStorage.getItem(STORE_KEY); } catch {}
  if (!token) return false;
  const payload = await verify(token);
  if (!payload) {
    try { localStorage.removeItem(STORE_KEY); } catch {}
    return false;
  }
  return true;
}

export function clearSession() {
  try { localStorage.removeItem(STORE_KEY); } catch {}
}
