// Simple dark mode utility with system detection and persistence
export const THEME_KEY = 'theme'; // 'light' | 'dark' | 'system'

export function getStoredTheme() {
  const v = localStorage.getItem(THEME_KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

export function getEffectiveTheme(pref = getStoredTheme()) {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  // system
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  return mq.matches ? 'dark' : 'light';
}

export function applyThemeToDocument(pref = getStoredTheme()) {
  const effective = getEffectiveTheme(pref);
  const root = document.documentElement; // <html>
  if (effective === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
}

export function setTheme(pref) {
  const allowed = ['light', 'dark', 'system'];
  const next = allowed.includes(pref) ? pref : 'system';
  localStorage.setItem(THEME_KEY, next);
  applyThemeToDocument(next);
}

export function initTheme() {
  // initial
  applyThemeToDocument(getStoredTheme());
  // watch system change if in system mode
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getStoredTheme() === 'system') applyThemeToDocument('system');
  };
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else mq.addListener?.(handler);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handler);
    else mq.removeListener?.(handler);
  };
}

export function toggleTheme() {
  const currentPref = getStoredTheme();
  const effective = getEffectiveTheme(currentPref);
  const next = effective === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
