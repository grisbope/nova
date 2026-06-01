import React, { useState } from 'react';
import { login } from '../lib/auth.js';

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export default function Login({ onSuccess }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const push = async (k) => {
    if (busy) return;
    setError('');
    if (k === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (k === '') return;
    const next = (pin + k).slice(0, 6);
    setPin(next);
    if (next.length === 6) {
      setBusy(true);
      const r = await login(next);
      if (r.ok) onSuccess?.();
      else { setError('PIN incorrecto'); setPin(''); setBusy(false); }
    }
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-center"
      style={{ background: 'radial-gradient(circle at 50% 40%, #0b1226 0%, #05060a 70%)' }}>
      <div className="text-white/80 text-2xl mb-1">Nex</div>
      <div className="text-white/40 text-xs mb-6">Introduce tu PIN</div>

      <div className="flex gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="w-3 h-3 rounded-full border border-white/40"
            style={{ background: i < pin.length ? '#1776FF' : 'transparent' }} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k, i) => (
          <button
            key={i}
            disabled={!k}
            onClick={() => push(k)}
            className={`w-16 h-16 rounded-2xl text-2xl text-white/90 ${
              k ? 'bg-white/[0.07] active:bg-white/20 border border-white/10' : 'opacity-0 pointer-events-none'
            }`}
          >{k}</button>
        ))}
      </div>

      <div className="mt-4 h-5 text-rose-400 text-sm">{error}</div>
    </div>
  );
}
