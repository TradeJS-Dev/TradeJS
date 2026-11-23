export const neutral = {
  50: '#f2f7fb',
  100: '#e0edf6',
  200: '#d2e0eb',
  300: '#b4c7d4',
  400: '#a8becd',
  500: '#8196a7',
  600: '#517084',
  700: '#263b4b',
  800: '#111e2b',
  900: '#0d1722',
  950: '#0a121c',
} as const;

export const teal = {
  50: '#eafdfa',
  100: '#ccf8f2',
  200: '#9bf3ea',
  300: '#67e0d9',
  400: '#2bc8bf',
  500: '#1ba69f',
  600: '#128378',
  700: '#14625f',
  800: '#1a3b43',
  900: '#122d35',
  950: '#061919',
} as const;

// Canvas renderers consume color values. CSS token references do not resolve in canvas.
export const marketColors = {
  up: teal[400],
  down: '#ff7886',
  upLabel: teal[600],
  downLabel: '#b84457',
  grid: '#233444',
  crosshairSurface: '#203748',
} as const;
