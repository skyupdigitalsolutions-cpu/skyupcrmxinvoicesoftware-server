/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand accent — driven by CSS variables set in ThemeContext (defaults: #2563EB / #1E40AF)
        primary:   { DEFAULT: 'var(--primary)' },
        secondary: { DEFAULT: 'var(--secondary)' },
        // Static fallback shades (used for hover/light states, focus rings, etc.)
        blue: { DEFAULT: '#2563EB', light: '#DBEAFE', pale: '#EFF6FF', dark: '#1E40AF' },
        // "gold" is the legacy accent name used throughout the UI; the brand is
        // now blue, so map it onto the blue accent. Without this, text-gold /
        // bg-gold / border-gold render with no color (e.g. invisible totals).
        gold: { DEFAULT: '#2563EB', light: '#DBEAFE', pale: '#EFF6FF', dark: '#1E40AF' },
        navy: { DEFAULT: '#1a1a2e', 800: '#16213e', 700: '#0f3460', 900: '#0B0B16' },
        ink: { DEFAULT: '#1a1a1a', 2: '#555555', 3: '#888888' },
        ok: { DEFAULT: '#0a7c59', light: '#e6f7f2' },
        danger: { DEFAULT: '#c0392b', light: '#fdf0ef' },
        info: { DEFAULT: '#1565c0', light: '#e8f0fe' },
        warn: { DEFAULT: '#e65100', light: '#fff3e0' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,.06)',
        lift: '0 6px 18px rgba(0,0,0,.12)',
      },
    },
  },
  plugins: [],
};