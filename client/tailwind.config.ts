import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Sidebar stays dark in both modes
        sidebar: '#0b1a2e',
        'sidebar-hover': '#122240',
        'sidebar-active': '#1a3a5c',

        // Severity (same in both modes)
        'sev-critical': '#ef4444',
        'sev-error': '#f97316',
        'sev-warning': '#eab308',
        'sev-info': '#3b82f6',
        'sev-ok': '#22c55e',

        // Accent
        accent: '#2563eb',
        'accent-light': '#3b82f6'
      },
      boxShadow: {
        panel: '0 12px 40px rgba(0, 0, 0, 0.18)'
      },
      animation: {
        'pulse-slow': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      }
    }
  },
  plugins: []
} satisfies Config;
