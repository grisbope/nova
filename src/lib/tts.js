// OpenAI TTS via same-origin nginx proxy (auth injected server-side).

const VOICE = import.meta.env.VITE_OPENAI_TTS_VOICE || 'echo';
const MODEL = import.meta.env.VITE_OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const BASE = (import.meta.env.VITE_TTS_BASE || '/tts/').replace(/\/?$/, '/');
const FORMAT = import.meta.env.VITE_OPENAI_TTS_FORMAT || 'mp3';
const SPEED = Number(import.meta.env.VITE_OPENAI_TTS_SPEED || 1.08);
const INSTRUCTIONS = import.meta.env.VITE_OPENAI_TTS_INSTRUCTIONS ||
  'Habla en espanol latino, natural, claro, cercano y con ritmo conversacional, ligeramente agil sin sonar apresurado.';

const EMOJI_RE = /\p{Extended_Pictographic}|[‍️⃣\u{1f3fb}-\u{1f3ff}]/gu;
const MD_RE = /[*_`~#>]+|^\s*[-•]\s+/gm;
const LINK_RE = /https?:\/\/\S+/g;

export function sanitizeForSpeech(text) {
  if (!text) return '';
  return String(text)
    .replace(EMOJI_RE, '')
    .replace(LINK_RE, ' ')
    .replace(MD_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let currentAudio = null;
let currentPlaybackResolve = null;
let queue = [];
let playing = false;

async function fetchAudio(text, signal) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    signal,
    body: JSON.stringify({
      model: MODEL,
      input: text,
      voice: VOICE,
      instructions: INSTRUCTIONS,
      response_format: FORMAT,
      speed: SPEED,
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function prepareAudio(item) {
  if (!item.audioPromise) item.audioPromise = fetchAudio(item.text, item.signal);
  return item.audioPromise;
}

function playUrl(url) {
  return new Promise((resolve) => {
    let done = false;
    const a = new Audio(url);
    const finish = () => {
      if (done) return;
      done = true;
      if (currentAudio === a) currentAudio = null;
      if (currentPlaybackResolve === finish) currentPlaybackResolve = null;
      URL.revokeObjectURL(url);
      resolve();
    };
    currentAudio = a;
    currentPlaybackResolve = finish;
    a.onended = finish;
    a.onerror = finish;
    a.play().catch(finish);
  });
}

async function pump(onIdle) {
  if (playing) return;
  playing = true;
  while (queue.length) {
    const item = queue.shift();
    const { signal } = item;
    if (signal?.aborted) continue;
    try {
      const next = queue[0];
      if (next && !next.signal?.aborted) prepareAudio(next).catch(() => {});
      const url = await prepareAudio(item);
      if (signal?.aborted) { URL.revokeObjectURL(url); continue; }
      if (queue[0] && !queue[0].signal?.aborted) prepareAudio(queue[0]).catch(() => {});
      await playUrl(url);
    } catch (e) {
      if (e.name === 'AbortError') break;
      console.warn('TTS failed, skipping chunk:', e.message);
    }
  }
  playing = false;
  onIdle?.();
}

export function ttsSpeak(text, { signal, onIdle } = {}) {
  const clean = sanitizeForSpeech(text);
  if (!clean) { onIdle?.(); return; }
  const item = { text: clean, signal, audioPromise: null };
  queue.push(item);
  if (playing) prepareAudio(item).catch(() => {});
  pump(onIdle);
}

export function ttsCancel() {
  for (const item of queue) {
    if (item.audioPromise) item.audioPromise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  queue = [];
  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
    try { currentAudio.src = ''; } catch {}
    currentAudio = null;
  }
  currentPlaybackResolve?.();
  currentPlaybackResolve = null;
  playing = false;
}

export function isTtsPlaying() { return playing; }

// Stream-aware queue: push deltas, flush by sentence boundary.
export function makeTtsSentenceQueue({ onStart, onIdle, signal } = {}) {
  let buffer = '';
  let started = false;
  const SPLIT = /([.!?¡¿…\n]+)/;

  const flushSentence = (sentence) => {
    const clean = sanitizeForSpeech(sentence);
    if (!clean) return;
    if (!started) { started = true; onStart?.(); }
    ttsSpeak(clean, { signal, onIdle });
  };

  return {
    push(delta) {
      buffer += delta;
      const parts = buffer.split(SPLIT);
      buffer = parts.pop() || '';
      let sentence = '';
      for (const p of parts) {
        sentence += p;
        if (/[.!?¡¿…\n]/.test(p)) {
          flushSentence(sentence);
          sentence = '';
        }
      }
      if (sentence) buffer = sentence + buffer;
    },
    end() {
      const tail = buffer.trim();
      buffer = '';
      if (tail) flushSentence(tail);
      // ensure onIdle fires even if nothing was queued
      if (!playing && queue.length === 0) onIdle?.();
    },
    cancel() {
      buffer = '';
      ttsCancel();
    },
  };
}
