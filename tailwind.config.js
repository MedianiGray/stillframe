/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#080B0A',
          900: '#0B0F0D',
          850: '#0F1412',
          800: '#131A17',
          750: '#17201C',
          700: '#1D2823',
          600: '#26332C',
          500: '#33443B',
        },
        paper: '#E7ECE8',
        muted: '#8A9A91',
        amber: {
          DEFAULT: '#E4A03C',
          dim: '#B87F2C',
          soft: '#2A2114',
        },
        signal: {
          ok: '#57C99A',
          warn: '#E2683F',
          rec: '#E5444B',
          info: '#6FA8DC',
        },
      },
      fontFamily: {
        mono: ['"Cascadia Mono"', '"Cascadia Code"', 'Consolas', '"SFMono-Regular"', 'ui-monospace', 'monospace'],
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', '"Microsoft YaHei UI"', '"PingFang SC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        stage: '0 24px 60px -24px rgba(0,0,0,0.85)',
        pop: '0 16px 40px -12px rgba(0,0,0,0.8)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        rise: 'rise 180ms ease-out both',
        sweep: 'sweep 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
