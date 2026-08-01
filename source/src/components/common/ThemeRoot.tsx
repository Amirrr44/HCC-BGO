/**
 * ThemeRoot — provides the MUI ThemeProvider bound to the current
 * theme mode.
 *
 * Also injects a tiny <style> block that colors the system status /
 * navigation bars to match the app background on supporting browsers.
 */

import { useEffect, useMemo } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { useTheme } from '../../store/theme';
import { buildTheme } from '../../theme';

export function ThemeRoot({ children }: { children: React.ReactNode }) {
  const mode = useTheme((s) => s.mode);
  const ready = useTheme((s) => s.ready);
  const init = useTheme((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  const theme = useMemo(() => buildTheme(mode), [mode]);

  // The CSS variable is also set by the store, but we keep an inline
  // style on the document element for redundancy.
  useEffect(() => {
    document.documentElement.style.setProperty('--app-bg', theme.palette.background.default);
  }, [theme]);

  if (!ready) {
    // Render nothing while we read the preference to avoid a flash.
    return null;
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Raw CSS to make the html / body and system bars match the
          theme. The browser uses these values for the address bar
          (mobile) and the status / nav bar (Android). */}
      <style>{`
        html, body, #root {
          background: ${theme.palette.background.default};
          color: ${theme.palette.text.primary};
          min-height: 100dvh;
        }
        body { margin: 0; }
      `}</style>
      {children}
    </ThemeProvider>
  );
}
