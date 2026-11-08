import { useColorScheme } from 'react-native';

/**
 * Two palettes, picked by the system dark-mode setting. Contrast ratios were
 * chosen to meet WCAG AA (4.5:1 for text, 3:1 for UI components) in BOTH modes.
 * Never hard-code colours in components: always go through useTheme().
 */
export interface Theme {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
  warningBg: string;
  warningText: string;
  isDark: boolean;
}

const light: Theme = {
  background: '#F4F5F7',
  surface: '#FFFFFF',
  border: '#8A8F98',
  text: '#14171C',
  textMuted: '#4A505A',
  accent: '#1F5FD1',
  onAccent: '#FFFFFF',
  danger: '#B3261E',
  warningBg: '#FFF1CC',
  warningText: '#4D3800',
  isDark: false,
};

const dark: Theme = {
  background: '#0F1114',
  surface: '#1A1D22',
  border: '#7C828C',
  text: '#ECEEF1',
  textMuted: '#AEB4BE',
  accent: '#8AB4FF',
  onAccent: '#0B1B3A',
  danger: '#F2B8B5',
  warningBg: '#3D3000',
  warningText: '#FFE08A',
  isDark: true,
};

export function useTheme(): Theme {
  // Re-renders automatically when the user flips dark mode while the app is open.
  return useColorScheme() === 'dark' ? dark : light;
}

/** Minimum touch target on Android per Material / WCAG 2.5.8: 48dp. */
export const MIN_TOUCH = 48;
