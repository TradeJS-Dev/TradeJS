import { createIdGenerator } from '../uuid';

describe('uuid utils', () => {
  it('returns last 12 characters by default', () => {
    const generateId = createIdGenerator(
      () => '12345678-1234-1234-1234-abcdefghijkl',
    );

    expect(generateId()).toBe('1234-abcdefghijkl'.slice(-12));
  });

  it('returns last N characters when len is provided', () => {
    const generateId = createIdGenerator(() => 'abcdef0123456789');

    expect(generateId(6)).toBe('456789');
  });
});
