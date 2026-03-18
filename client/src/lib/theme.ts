export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pulse-theme';

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  localStorage.setItem(STORAGE_KEY, theme);
}

/** Call once on app startup to apply the stored preference. */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}
