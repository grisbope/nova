const RAW_WAKE_WORDS =
  import.meta.env.VITE_WAKE_WORDS ||
  import.meta.env.VITE_WAKE_WORD ||
  'nova,alexa,daye,jarvis';

const EXTRA_ALIASES = {
  alexa: ['alexia', 'aleja', 'alexa', 'aleksa', 'alesa', 'alex'],
  daye: ['daye', 'day', 'dai', 'daje', 'deye', 'dey', 'die'],
  jarvis: ['jarvis', 'yarvis', 'jervis', 'charvis', 'harvis', 'jarbis'],
  nova: ['nova', 'noba'],
  nex: ['nex', 'nix', 'next', 'neks', 'nexo'],
};

const STOP = new Set([
  'a', 'al', 'el', 'la', 'las', 'los', 'un', 'una', 'uno',
  'no', 'ni', 'ne', 'na', 'nos', 'ya', 'si', 'es', 'oye', 'hey',
]);

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function splitList(value) {
  return normalize(value)
    .split(/[,\n|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(text) {
  return normalize(text).split(/[\s,.!?"'\-:;]+/).filter(Boolean);
}

export const wakeWords = Array.from(new Set(splitList(RAW_WAKE_WORDS)));
export const wakeLabel = wakeWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(', ');

const WAKE_TOKENS = new Set();
for (const word of wakeWords) {
  WAKE_TOKENS.add(word);
  for (const alias of EXTRA_ALIASES[word] || []) WAKE_TOKENS.add(normalize(alias));
}

function isWakeToken(token) {
  if (!token || STOP.has(token)) return false;
  return WAKE_TOKENS.has(token);
}

export function containsWake(text) {
  return tokenize(text).some(isWakeToken);
}

export function stripWake(text) {
  const parts = normalize(text).split(/(\s+)/);
  const kept = parts.filter((p) => {
    if (/^\s+$/.test(p)) return true;
    return !isWakeToken(p.replace(/[,.!?"'\-:;]/g, ''));
  });
  return kept.join('').replace(/\s+/g, ' ').trim();
}

export function utteranceAfterWake(text) {
  const tokens = tokenize(text);
  let idx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (isWakeToken(tokens[i])) idx = i;
  }
  if (idx < 0) return '';
  return tokens.slice(idx + 1).join(' ');
}
