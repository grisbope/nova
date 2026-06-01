import React from 'react';

const palette = {
  idle:      { from: '#1f2a44', to: '#0b1020', ring: '#2b3a5a', anim: 'animate-breathe' },
  listening: { from: '#1776FF', to: '#0a2b6e', ring: '#3a8aff', anim: 'animate-pulseFast' },
  thinking:  { from: '#9f43ff', to: '#2a0a4a', ring: '#b56bff', anim: 'animate-breathe' },
  speaking:  { from: '#22d3a8', to: '#063b30', ring: '#3ee8be', anim: 'animate-pulseFast' },
  error:     { from: '#ff3b5c', to: '#3a0612', ring: '#ff7088', anim: 'animate-pulseFast' },
};

export default function Orb({ state = 'idle' }) {
  const p = palette[state] || palette.idle;
  const showRipple = state === 'listening' || state === 'speaking';
  return (
    <div className="relative flex items-center justify-center" style={{ width: 280, height: 280 }}>
      {showRipple && (
        <>
          <span className="absolute rounded-full animate-ripple" style={{ width: 240, height: 240, border: `2px solid ${p.ring}` }} />
          <span className="absolute rounded-full animate-ripple" style={{ width: 240, height: 240, border: `2px solid ${p.ring}`, animationDelay: '0.6s' }} />
          <span className="absolute rounded-full animate-ripple" style={{ width: 240, height: 240, border: `2px solid ${p.ring}`, animationDelay: '1.2s' }} />
        </>
      )}
      {state === 'thinking' && (
        <span className="absolute rounded-full animate-spinSlow" style={{ width: 260, height: 260, border: `3px solid transparent`, borderTopColor: p.ring, borderRightColor: p.ring }} />
      )}
      <div
        className={`rounded-full shadow-2xl ${p.anim}`}
        style={{
          width: 220,
          height: 220,
          background: `radial-gradient(circle at 35% 30%, ${p.from} 0%, ${p.to} 70%, #000 100%)`,
          boxShadow: `0 0 80px 4px ${p.ring}55, inset 0 0 60px ${p.from}aa`,
        }}
      />
    </div>
  );
}
