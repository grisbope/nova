// STT via continuous PCM buffer + VAD + same-origin proxy (/stt/) to OpenAI.
// PCM is recorded continuously through a ScriptProcessor; when VAD opens, we slice from
// 300ms BEFORE the trigger (pre-roll) so the leading edge of speech isn't cut off
// (the classic "prende el tele" → "del tele" problem).

const LANG_TO_ISO = { 'es-ES': 'es', 'es-MX': 'es', 'es': 'es', 'en-US': 'en', 'en-GB': 'en', 'en': 'en' };
const STT_MODEL = import.meta.env.VITE_OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe';

export const speechSupported = Boolean(
  typeof navigator !== 'undefined' &&
  navigator.mediaDevices?.getUserMedia &&
  typeof window !== 'undefined'
);

// --- WAV encoding (mono int16) ---
function encodeWav(float32, sampleRate) {
  const n = float32.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (offset, str) => { for (let i = 0; i < str.length; i++) v.setUint8(offset + i, str.charCodeAt(i)); };
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);          // PCM
  v.setUint16(22, 1, true);          // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function transcribeBlob(blob, lang) {
  const fd = new FormData();
  fd.append('file', blob, 'chunk.wav');
  fd.append('model', STT_MODEL);
  const iso = LANG_TO_ISO[lang] || LANG_TO_ISO[lang?.slice(0, 2)] || 'es';
  fd.append('language', iso);
  fd.append('response_format', 'json');
  fd.append('prompt', 'Transcribe voz conversacional en espanol latino. Devuelve solo las palabras habladas.');
  const r = await fetch('/stt/', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`STT HTTP ${r.status}`);
  const j = await r.json();
  return (j.text || '').trim();
}

export function makeResilientRecognizer({ lang = 'es-ES', onResult, onError, onState } = {}) {
  let wantRunning = false;
  let paused = false;
  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let scriptNode = null;
  let sinkGain = null;
  let rafId = null;
  let pendingTranscriptions = 0;

  // Tunables
  const RMS_OPEN = Number(import.meta.env.VITE_VAD_RMS_OPEN || 0.01);
  const RMS_CLOSE = Number(import.meta.env.VITE_VAD_RMS_CLOSE || 0.0045);
  const VOICE_FRAMES_TO_OPEN = Number(import.meta.env.VITE_VAD_OPEN_FRAMES || 2);
  const SILENCE_FRAMES_TO_CLOSE = 30; // ~500ms
  const MAX_UTTERANCE_MS = 8000;
  const MIN_RECORDING_MS = 350;
  const PRE_ROLL_MS = 300;            // include 300ms before VAD trigger

  // PCM circular buffer (raw mono Float32 at audioCtx.sampleRate)
  let pcmRing = null;
  let ringLen = 0;
  let writeIdx = 0;
  let voicedFrames = 0;
  let silentFrames = 0;
  let recording = false;
  let utteranceStartIdx = 0; // absolute samples written counter at start
  let totalWritten = 0;      // monotonic write counter

  const reset = () => {
    voicedFrames = 0; silentFrames = 0; recording = false;
  };

  const sliceUtterance = (startWritten, endWritten) => {
    // Returns Float32 slice from circular buffer between two absolute write positions.
    if (!pcmRing) return null;
    const sampleCount = endWritten - startWritten;
    if (sampleCount <= 0 || sampleCount > ringLen) return null;
    const out = new Float32Array(sampleCount);
    let absRead = startWritten;
    let outIdx = 0;
    while (absRead < endWritten) {
      const ringIdx = ((absRead % ringLen) + ringLen) % ringLen;
      const len = Math.min(endWritten - absRead, ringLen - ringIdx, sampleCount - outIdx);
      out.set(pcmRing.subarray(ringIdx, ringIdx + len), outIdx);
      absRead += len;
      outIdx += len;
    }
    return out;
  };

  const finishUtterance = async () => {
    if (!recording) return;
    recording = false;
    const endWritten = totalWritten;
    const sampleRate = audioCtx?.sampleRate || 48000;
    const durationMs = ((endWritten - utteranceStartIdx) / sampleRate) * 1000;
    if (durationMs < MIN_RECORDING_MS) return;
    const pcm = sliceUtterance(utteranceStartIdx, endWritten);
    if (!pcm) return;
    const blob = encodeWav(pcm, sampleRate);
    pendingTranscriptions++;
    onState?.('thinking');
    try {
      const raw = await transcribeBlob(blob, lang);
      const text = (raw || '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/\*[^*]*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) onResult?.({ text, isFinal: true });
    } catch (err) {
      onError?.('network');
    } finally {
      pendingTranscriptions--;
      if (wantRunning && pendingTranscriptions === 0) onState?.('listening');
    }
  };

  const tick = () => {
    if (!analyser || !wantRunning) return;
    if (paused) { rafId = requestAnimationFrame(tick); return; }
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);

    if (!recording) {
      if (rms > RMS_OPEN) {
        if (++voicedFrames >= VOICE_FRAMES_TO_OPEN) {
          // Open utterance — go BACK 300ms into the buffer
          const sampleRate = audioCtx.sampleRate;
          const preRollSamples = Math.floor(sampleRate * PRE_ROLL_MS / 1000);
          utteranceStartIdx = Math.max(0, totalWritten - preRollSamples);
          recording = true;
          silentFrames = 0;
          onState?.('capturing');
        }
      } else {
        voicedFrames = 0;
      }
    } else {
      const sampleRate = audioCtx.sampleRate;
      const elapsedMs = ((totalWritten - utteranceStartIdx) / sampleRate) * 1000;
      if (rms < RMS_CLOSE) {
        if (++silentFrames >= SILENCE_FRAMES_TO_CLOSE) finishUtterance();
      } else {
        silentFrames = 0;
      }
      if (elapsedMs > MAX_UTTERANCE_MS) finishUtterance();
    }
    rafId = requestAnimationFrame(tick);
  };

  const cleanup = () => {
    if (rafId) cancelAnimationFrame(rafId); rafId = null;
    try { scriptNode?.disconnect(); } catch {}
    try { sinkGain?.disconnect(); } catch {}
    try { stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { audioCtx?.close(); } catch {}
    scriptNode = sinkGain = stream = audioCtx = analyser = null;
    pcmRing = null;
    ringLen = 0; writeIdx = 0; totalWritten = 0;
    reset();
  };

  const begin = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      onError?.('not-allowed');
      wantRunning = false;
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch {} }
    const src = audioCtx.createMediaStreamSource(stream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    src.connect(analyser);

    // Circular PCM buffer — 10 seconds at native sample rate.
    ringLen = audioCtx.sampleRate * 10;
    pcmRing = new Float32Array(ringLen);
    writeIdx = 0;
    totalWritten = 0;

    // ScriptProcessor to capture PCM continuously (deprecated but works in WebView).
    const bufSize = 4096;
    scriptNode = audioCtx.createScriptProcessor(bufSize, 1, 1);
    scriptNode.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i++) {
        pcmRing[writeIdx] = input[i];
        writeIdx = (writeIdx + 1) % ringLen;
        totalWritten++;
      }
    };
    src.connect(scriptNode);
    // Connect to a silent sink so ScriptProcessor keeps running without audible feedback.
    sinkGain = audioCtx.createGain();
    sinkGain.gain.value = 0;
    scriptNode.connect(sinkGain);
    sinkGain.connect(audioCtx.destination);

    onState?.('listening');
    rafId = requestAnimationFrame(tick);
  };

  return {
    start() {
      if (wantRunning) return;
      wantRunning = true;
      paused = false;
      begin();
    },
    stop() {
      wantRunning = false;
      cleanup();
      onState?.('ended');
    },
    abort() {
      wantRunning = false;
      cleanup();
      onState?.('ended');
    },
    pause() {
      if (paused) return;
      paused = true;
      recording = false;
      voicedFrames = 0; silentFrames = 0;
    },
    resume() {
      if (!paused) return;
      paused = false;
      voicedFrames = 0; silentFrames = 0;
    },
    isRunning: () => wantRunning && !paused,
    isPaused: () => paused,
  };
}

// --- Web Speech API TTS (kept for legacy callers, but main TTS is in lib/tts.js) ---

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export function cancelSpeech() { try { synth?.cancel(); } catch {} }
export function isSpeaking() { return Boolean(synth?.speaking); }

// --- Wake-word chime (soft bell-like) ---

let _audioCtx = null;
function _ctx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { _audioCtx = null; }
  }
  return _audioCtx;
}
export function chime(kind = 'wake') {
  const ctx = _ctx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
  const now = ctx.currentTime;
  const freq = kind === 'wake' ? 880 : 523;
  const peak = 0.06;
  const dur = 0.45;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(peak * 0.25, now + 0.04);
  gain2.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.7);

  osc.connect(gain).connect(ctx.destination);
  osc2.connect(gain2).connect(ctx.destination);
  osc.start(now); osc.stop(now + dur + 0.05);
  osc2.start(now); osc2.stop(now + dur * 0.7 + 0.05);
}
