import React, { useEffect, useRef, useState, useCallback } from 'react';
import Orb from './components/Orb.jsx';
import Login from './components/Login.jsx';
import { makeResilientRecognizer, speechSupported, chime } from './lib/speech.js';
import { makeTtsSentenceQueue, ttsCancel } from './lib/tts.js';
import { streamReply, resetHistory } from './lib/openclaw.js';
import { checkSession } from './lib/auth.js';
import { containsWake, stripWake, utteranceAfterWake, wakeLabel } from './lib/wakeword.js';

const WAKE_LABEL = wakeLabel || 'Nova, Alexa, Daye, Jarvis';
const LANG = import.meta.env.VITE_LANG || 'es-ES';
const TURN_SILENCE_MS = Number(import.meta.env.VITE_SILENCE_MS || 900);
const POST_WAKE_TIMEOUT_MS = Number(import.meta.env.VITE_POST_WAKE_MS || 3000);
const MIN_UTTERANCE_LEN = 2;
const POST_SPEECH_COOLDOWN_MS = Number(import.meta.env.VITE_POST_SPEECH_COOLDOWN_MS || 1500);

// state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [state, setState] = useState('idle');
  const [hint, setHint] = useState(`Di "${WAKE_LABEL}" o toca el orbe`);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const [armed, setArmed] = useState(false);

  const recRef = useRef(null);
  const ttsRef = useRef(null);
  const abortRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const utteranceRef = useRef('');
  const finalsRef = useRef('');
  const stateRef = useRef('idle');
  const ignoreUntilRef = useRef(0);
  const setS = (s) => { stateRef.current = s; setState(s); };

  useEffect(() => { (async () => setAuthed(await checkSession()))(); }, []);

  const cleanup = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    abortRef.current?.abort?.();
    abortRef.current = null;
    ttsRef.current?.cancel?.();
    ttsCancel();
  }, []);

  const goIdle = useCallback((msg) => {
    cleanup();
    // After speaking/thinking, ignore any audio for the cooldown — kills the
    // "Nex talks → TTS echoes into mic → re-activates" loop.
    const wasActive = stateRef.current === 'speaking' || stateRef.current === 'thinking';
    if (wasActive) {
      ignoreUntilRef.current = Date.now() + POST_SPEECH_COOLDOWN_MS;
      // Resume mic *after* the cooldown so any TTS tail or echo doesn't even reach VAD.
      setTimeout(() => { recRef.current?.resume?.(); }, POST_SPEECH_COOLDOWN_MS);
    } else {
      recRef.current?.resume?.();
    }
    utteranceRef.current = '';
    finalsRef.current = '';
    setPartial('');
    setHint(msg || `Di "${WAKE_LABEL}" o toca el orbe`);
    setS('idle');
  }, [cleanup]);

  const sendToOpenclaw = useCallback(async (text) => {
    const clean = stripWake(text).trim();
    if (!clean || clean.length < MIN_UTTERANCE_LEN) { goIdle(); return; }
    // Pause mic NOW — kill any in-flight recording before TTS starts so Nex's
    // own voice can't be captured and replayed as a wake.
    recRef.current?.pause?.();
    setS('thinking');
    setHint('');
    setPartial(clean);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const tts = makeTtsSentenceQueue({
      signal: ctrl.signal,
      onStart: () => { if (stateRef.current !== 'speaking') { setS('speaking'); setHint(''); } },
      onIdle: () => { if (stateRef.current === 'speaking') goIdle(); },
    });
    ttsRef.current = tts;
    try {
      await streamReply(clean, {
        signal: ctrl.signal,
        onDelta: (delta) => tts.push(delta),
        onDone: () => tts.end(),
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error(e);
      // Never display raw HTML / stack traces. Map to short user-friendly messages.
      let msg = 'Sin conexión';
      const raw = String(e?.message || e || '');
      if (/abort/i.test(raw)) return;
      if (/sin conexión|no disponible|network|fetch/i.test(raw)) msg = 'Sin conexión';
      else if (raw && !/[<>]/.test(raw) && raw.length < 80) msg = raw;
      setError(msg);
      setS('error');
      setHint('');
      setTimeout(() => { setError(''); goIdle(); }, 2500);
    }
  }, [goIdle]);

  const startListening = useCallback((initialAfterWake = '') => {
    setS('listening');
    setHint('');
    utteranceRef.current = initialAfterWake;
    finalsRef.current = initialAfterWake;
    setPartial(initialAfterWake);
    chime('wake');

    clearTimeout(silenceTimerRef.current);
    const gracMs = initialAfterWake ? TURN_SILENCE_MS : POST_WAKE_TIMEOUT_MS;
    silenceTimerRef.current = setTimeout(() => {
      const utt = (finalsRef.current || utteranceRef.current).trim();
      if (utt && stripWake(utt).length >= MIN_UTTERANCE_LEN) sendToOpenclaw(utt);
      else goIdle();
    }, gracMs);
  }, [sendToOpenclaw, goIdle]);

  const handleResult = useCallback(({ text, isFinal }) => {
    if (!text) return;
    const st = stateRef.current;

    if (Date.now() < ignoreUntilRef.current) return;

    if (st === 'idle') {
      if (!containsWake(text)) return;
      const after = utteranceAfterWake(text);
      // "Nex apaga el aire" → send immediately. The user already finished the
      // sentence (VAD detected end-of-utterance), so don't open a stale window
      // that might catch unrelated conversation.
      if (after && stripWake(after).length >= MIN_UTTERANCE_LEN) {
        startListening(after);
        // Fast-track: commit the command right away.
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          const utt = (finalsRef.current || utteranceRef.current).trim();
          if (utt && stripWake(utt).length >= MIN_UTTERANCE_LEN) sendToOpenclaw(utt);
          else goIdle();
        }, 300);
      } else {
        // User said just "Nex" alone — short grace, accept only ONE follow-up utterance.
        startListening('');
      }
      return;
    }

    if (st === 'listening') {
      // Accept only ONE final utterance after wake-alone — no append, no extend.
      if (isFinal && text) {
        const candidate = stripWake(text).trim();
        if (candidate.length >= MIN_UTTERANCE_LEN) {
          finalsRef.current = candidate;
          utteranceRef.current = candidate;
          setPartial(candidate);
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => sendToOpenclaw(candidate), 200);
        } else {
          goIdle();
        }
      }
    }
    // thinking/speaking: ignore input.
  }, [startListening, sendToOpenclaw, goIdle]);

  const arm = useCallback(() => {
    if (armed) return;
    setArmed(true);
    setError('');
    resetHistory();
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis?.speak(u);
    } catch {}
    if (!speechSupported) {
      setError('Micrófono no soportado.');
      setS('error');
      return;
    }
    const rec = makeResilientRecognizer({
      lang: LANG,
      onResult: handleResult,
      onError: (err) => {
        if (err === 'not-allowed') {
          setError('Permiso de micrófono denegado.');
          setS('error');
        }
      },
    });
    recRef.current = rec;
    rec.start();
    setHint(`Di "${WAKE_LABEL}" o toca el orbe`);
  }, [armed, handleResult]);

  // Tap-to-wake: tap on orb during idle goes straight to listening.
  const onOrbClick = useCallback((e) => {
    e.stopPropagation();
    if (!armed) { arm(); return; }
    if (stateRef.current === 'idle') {
      startListening('');
    } else if (stateRef.current === 'speaking') {
      // Tap during speech = interrupt and listen
      ttsRef.current?.cancel?.();
      abortRef.current?.abort?.();
      startListening('');
    }
  }, [armed, arm, startListening]);

  useEffect(() => () => { recRef.current?.abort?.(); cleanup(); }, [cleanup]);

  if (authed === null) {
    return <div className="h-full w-full bg-nex-bg" />;
  }
  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  const statusText = error
    ? error
    : !armed
      ? 'Toca para activar'
      : state === 'listening'
        ? (partial || '')
        : state === 'thinking'
          ? ''
          : state === 'speaking'
            ? ''
            : hint;

  return (
    <div
      onClick={arm}
      className="h-full w-full flex flex-col items-center justify-center select-none overflow-hidden relative"
      style={{ background: 'radial-gradient(circle at 50% 40%, #0b1226 0%, #05060a 70%)' }}
    >
      <div onClick={onOrbClick} className="cursor-pointer active:scale-95 transition-transform">
        <Orb state={armed ? state : 'idle'} />
      </div>
      <div className="mt-6 text-center px-6 max-w-[92vw]">
        <div className="text-xl text-white/90 leading-snug min-h-[2.4rem]">
          {statusText}
        </div>
      </div>

<div className="absolute top-3 right-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/30">
        <span className={`w-2 h-2 rounded-full ${armed ? 'bg-emerald-400' : 'bg-white/30'}`} />
        Nex
      </div>
    </div>
  );
}
