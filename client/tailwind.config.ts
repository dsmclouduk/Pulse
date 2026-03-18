import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Sidebar — stays dark in both modes
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
        'accent-light': '#3b82f6',

        // Light mode surfaces (default)
        'lm-bg': '#f5f6f8',
        'lm-surface': '#ffffff',
        'lm-surface-alt': '#fafbfc',
        'lm-hover': '#f0f4ff',
        'lm-header': '#f5f6f8',
        'lm-border': '#e5e7eb',
        'lm-text': '#1a1a2e',
        'lm-text-secondary': '#6b7280',

        // Dark mode surfaces
        'dm-bg': '#0a0d10',
        'dm-surface': '#111820',
        'dm-surface-alt': '#0f1519',
        'dm-hover': '#1a2332',
        'dm-header': '#151d28',
        'dm-border': 'rgba(255,255,255,0.08)',
        'dm-text': '#e5e7eb',
        'dm-text-secondary': '#9ca3af',

        // Legacy (keep for existing components that haven't migrated)
        graphite: '#0f1419',
        ink: '#0a0d10',
        steel: '#17212b',
        cyan: '#74d3ff',
        ember: '#ff9b4a',
        alarm: '#ff5d5d',
        resolved: '#42d48e',
      },
      boxShadow: {
        panel: '0 24px 80px rgba(0, 0, 0, 0.35)',
      },
      animation: {
        'pulse-slow': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      width: {
        sidebar: '4rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
