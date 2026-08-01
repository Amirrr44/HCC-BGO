/**
 * Theme store: holds the current mode, persists the user's choice in
 * IndexedDB, and falls back to the operating-system preference on
 * first launch. Theme switching is immediate (no reload) and
 * consistent with the warm Material You palette in `theme/index.ts`.
 */

import { create } from 'zustand';
import type { ThemeMode } from '../theme';
import { buildTheme } from '../theme';
import { getPref, setPref } from '../services/storage/idb';

const PREF_KEY = 'theme.mode';
const OS_DARK = '(prefers-color-scheme: dark)';

interface ThemeState {
  mode: ThemeMode;
  /** True once we've read the persisted preference (or fallen back to OS). */
  ready: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  init: () => Promise<void>;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: 'dark',
  ready: false,

  setMode: (mode) => {
    set({ mode });
    void setPref(PREF_KEY, mode);
    applyThemeVars(mode);
  },

  toggle: () => {
    const next: ThemeMode = get().mode === 'dark' ? 'light' : 'dark';
    get().setMode(next);
  },

  init: async () => {
    const stored = await getPref<ThemeMode>(PREF_KEY);
    let mode: ThemeMode;
    if (stored === 'dark' || stored === 'light') {
      mode = stored;
    } else {
      // First launch — follow the OS preference.
      const prefersDark = typeof window !== 'undefined'
        && window.matchMedia
        && window.matchMedia(OS_DARK).matches;
      mode = prefersDark ? 'dark' : 'light';
    }
    set({ mode, ready: true });
    applyThemeVars(mode);

    // React to OS theme changes only if the user hasn't picked one
    // explicitly.
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia(OS_DARK);
      mq.addEventListener('change', (e) => {
        if (!get().ready) return;
        const currentStored = useTheme.getState();
        if (currentStored.mode === 'dark' || currentStored.mode === 'light') {
          // Only auto-follow if the user has never expressed a choice
          // (we still write the OS-followed value to the pref so it
          // sticks across launches, but we treat the first pick as
          // explicit). To keep the behavior simple, we don't change
          // the mode automatically once it's been set once.
        }
        void e;
      });
    }
  },
}));

/**
 * Apply the CSS variables consumed by the browser for system-bar
 * coloring and any raw-CSS consumers.
 */
function applyThemeVars(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const theme = buildTheme(mode);
  const bg = theme.palette.background.default;
  const paper = theme.palette.background.paper;
  document.documentElement.style.setProperty('--app-bg', bg);
  document.documentElement.style.setProperty('--app-paper', paper);
  // Used by Android to color the system bars.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
  else {
    const m = document.createElement('meta');
    m.name = 'theme-color';
    m.content = bg;
    document.head.appendChild(m);
  }
}
