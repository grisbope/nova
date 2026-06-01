/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        nex: {
          bg: '#05060a',
          ring: '#1776FF',
          dim: '#0e1118',
        },
      },
      animation: {
        breathe: 'breathe 4s ease-in-out infinite',
        pulseFast: 'pulseFast 0.9s ease-in-out infinite',
        spinSlow: 'spin 2.4s linear infinite',
        ripple: 'ripple 1.8s ease-out infinite',
      },
      keyframes: {
        breathe: {
          '0%,100%': { transform: 'scale(1)', opacity: '0.85' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
        pulseFast: {
          '0%,100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.12)', opacity: '0.9' },
        },
        ripple: {
          '0%': { transform: 'scale(1)', opacity: '0.55' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
