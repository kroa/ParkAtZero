/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          'Helvetica Neue',
          'Segoe UI',
          'Apple SD Gothic Neo',
          'Noto Sans KR',
          'Malgun Gothic',
          'sans-serif',
        ],
        numeric: ['Inter', 'Pretendard Variable', 'Pretendard', 'sans-serif'],
      },
      colors: {
        /* ── 상태 컬러 시스템 ─────────────────────────────
         * free        : 선택한 방문 시간에 완전 무료 (초록)
         * conditional : 조건부 무료 — 시간제한/대상제한/부분무료 (주황)
         * paid        : 현재 유료 운영 시간대 (회색)
         * closed      : 운영시간 외 (더 어두운 회색)
         * ------------------------------------------------ */
        free: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          DEFAULT: '#10b981',
        },
        conditional: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
          DEFAULT: '#f97316',
        },
        paid: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          DEFAULT: '#64748b',
        },
        brand: {
          50: '#eef6ff',
          100: '#d9ecff',
          200: '#bcdeff',
          300: '#8ecaff',
          400: '#59acff',
          500: '#328bff',
          600: '#1b6cf5',
          700: '#1556e1',
          800: '#1848b6',
          900: '#1a408f',
          DEFAULT: '#328bff',
        },
        ink: {
          DEFAULT: 'rgb(var(--pz-ink) / <alpha-value>)',
          soft: 'rgb(var(--pz-ink-soft) / <alpha-value>)',
          mute: 'rgb(var(--pz-ink-mute) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--pz-surface) / <alpha-value>)',
          raised: 'rgb(var(--pz-surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--pz-surface-sunken) / <alpha-value>)',
        },
        hairline: 'rgb(var(--pz-hairline) / <alpha-value>)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        glass:
          '0 1px 1px 0 rgb(0 0 0 / 0.02), 0 8px 24px -6px rgb(15 23 42 / 0.12), 0 24px 48px -24px rgb(15 23 42 / 0.22)',
        'glass-dark':
          '0 1px 1px 0 rgb(0 0 0 / 0.4), 0 8px 24px -6px rgb(0 0 0 / 0.55), 0 24px 48px -24px rgb(0 0 0 / 0.7)',
        sheet: '0 -8px 40px -12px rgb(15 23 42 / 0.24)',
        marker: '0 6px 16px -4px rgb(15 23 42 / 0.35)',
        'inner-hairline': 'inset 0 1px 0 0 rgb(255 255 255 / 0.35)',
        focus: '0 0 0 3px rgb(50 139 255 / 0.35)',
      },
      backdropBlur: {
        xs: '2px',
        '2xl': '28px',
        '3xl': '44px',
      },
      transitionTimingFunction: {
        // Apple 계열 UI 의 표준 감속 곡선
        apple: 'cubic-bezier(0.32, 0.72, 0, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.55' },
          '70%': { transform: 'scale(1.9)', opacity: '0' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.24, 0.6, 0.36, 1) infinite',
        'fade-up': 'fade-up 0.32s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
      screens: {
        xs: '400px',
      },
    },
  },
  plugins: [],
}
