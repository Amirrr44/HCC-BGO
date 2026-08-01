/**
 * Material Design 3 (Material You) theme with explicit dark and light
 * palettes. The accent is a warm amber/orange that pairs well with both
 * warm-gray and cream backgrounds.
 *
 * Avoids pure black / pure white. Uses deep brown-blacks for dark mode
 * and warm off-white for light mode, per the patch spec.
 */

import { createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';

export type ThemeMode = 'dark' | 'light';

/* ------------------------------------------------------------------ */
/* Dark mode palette — warm brown-blacks and amber accents             */
/* ------------------------------------------------------------------ */
const darkPalette: ThemeOptions['palette'] = {
  mode: 'dark',
  primary: {
    main: '#E89B3C',     // warm amber / deep gold
    light: '#F2B870',
    dark: '#B87520',
    contrastText: '#1A1208',
  },
  secondary: {
    main: '#D49A6A',     // soft warm orange
    contrastText: '#1A1208',
  },
  background: {
    default: '#1A1612', // warm near-black, brown undertone
    paper: '#221C17',   // slightly lighter warm surface
  },
  surface: {
    main: '#2A231C',
  },
  text: {
    primary: '#F2EAD9',   // warm off-white
    secondary: '#B8A990', // warm muted
  },
  divider: 'rgba(232, 155, 60, 0.12)',
  error: {
    main: '#E27D6A',     // warm coral, not cold red
  },
  warning: {
    main: '#E8B647',
  },
  success: {
    main: '#8FB377',     // muted olive-green
  },
  info: {
    main: '#A89A6E',
  },
};

/* ------------------------------------------------------------------ */
/* Light mode palette — cream and warm amber                           */
/* ------------------------------------------------------------------ */
const lightPalette: ThemeOptions['palette'] = {
  mode: 'light',
  primary: {
    main: '#B87520',     // deep warm gold for contrast on cream
    light: '#E89B3C',
    dark: '#8B5300',
    contrastText: '#FFFAF0',
  },
  secondary: {
    main: '#A35F2A',
    contrastText: '#FFFAF0',
  },
  background: {
    default: '#FAF4E8', // warm cream
    paper: '#FFFAF0',   // warmer off-white
  },
  surface: {
    main: '#F0E5D2',
  },
  text: {
    primary: '#2A1F12',
    secondary: '#6B5A45',
  },
  divider: 'rgba(184, 117, 32, 0.16)',
  error: {
    main: '#B85A45',
  },
  warning: {
    main: '#C99A2E',
  },
  success: {
    main: '#5E7F47',
  },
  info: {
    main: '#6E6240',
  },
};

const commonComponents: ThemeOptions['components'] = {
  MuiButton: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 600,
        borderRadius: 12,
        paddingInline: 18,
      },
    },
  },
  MuiPaper: {
    styleOverrides: {
      root: {
        backgroundImage: 'none',
        borderRadius: 12,
      },
    },
  },
  MuiAppBar: {
    styleOverrides: {
      root: {
        backgroundImage: 'none',
        backgroundColor: 'transparent',
        backdropFilter: 'blur(14px)',
        // We set the actual color from the page so it matches the
        // application background exactly.
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 12,
      },
    },
  },
  MuiTextField: {
    defaultProps: {
      variant: 'outlined',
      fullWidth: true,
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 12,
      },
    },
  },
  MuiInputBase: {
    styleOverrides: {
      root: {
        borderRadius: 12,
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: 12,
      },
    },
  },
  MuiMenu: {
    styleOverrides: {
      paper: {
        borderRadius: 12,
      },
    },
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        borderRadius: 12,
      },
    },
  },
  MuiTooltip: {
    styleOverrides: {
      tooltip: {
        borderRadius: 12,
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: 12,
      },
    },
  },
  MuiCssBaseline: {
    styleOverrides: {
      body: {
        // Match the system bars to the application background.
        // Capable browsers (Android, modern iOS, Chromium) honor this.
        backgroundColor: 'var(--app-bg)',
      },
    },
  },
};

/**
 * Build a theme for the given mode. The CSS variable `--app-bg` is set
 * on the <html> element by the ThemeRoot component so the browser
 * can use it to color the system status / navigation bars.
 */
export function buildTheme(mode: ThemeMode): Theme {
  const isDark = mode === 'dark';
  const palette = isDark ? darkPalette : lightPalette;
  return createTheme({
    palette,
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        '"Inter", "SF Pro Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
      h6: { fontWeight: 600 },
      body1: { lineHeight: 1.55 },
    },
    components: commonComponents,
  });
}

/**
 * Color tokens for the squircle / status dot / etc. that need to be
 * applied outside the MUI theme system (e.g. raw CSS).
 */
export const statusColors: Record<string, { dark: string; light: string }> = {
  trusted: { dark: '#8FB377', light: '#5E7F47' },
  untrusted: { dark: '#E8B647', light: '#C99A2E' },
  wrong: { dark: '#E27D6A', light: '#B85A45' },
  plain: { dark: '#3D342B', light: '#8B7E6B' },
};
