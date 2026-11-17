import { safeCallbackUrl } from '../safeCallbackUrl';

it.each([
  'https://trusted.example//evil.example/',
  'https://evil.example/',
  '//evil.example/',
  'javascript:alert(1)',
  '/\\evil.example/',
  ' https://evil.example/',
  'https://trusted.example.evil/',
])('rejects untrusted navigation %s', (value) =>
  expect(safeCallbackUrl(value, 'https://trusted.example')).toBe(
    '/routes/dashboard',
  ),
);
it.each([
  '/routes/signals?symbol=BTCUSDT#details',
  'https://trusted.example/routes/dashboard',
])('preserves same-origin navigation %s', (value) =>
  expect(safeCallbackUrl(value, 'https://trusted.example')).toBe(
    new URL(value, 'https://trusted.example').pathname +
      new URL(value, 'https://trusted.example').search +
      new URL(value, 'https://trusted.example').hash,
  ),
);
