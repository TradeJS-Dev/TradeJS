import { uuid } from '../uuid';

const mockRandomUUID = jest.fn();

jest.mock('node:crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

describe('uuid utils', () => {
  it('returns last 12 characters by default', () => {
    mockRandomUUID.mockReturnValue('12345678-1234-1234-1234-abcdefghijkl');

    expect(uuid()).toBe('1234-abcdefghijkl'.slice(-12));
  });

  it('returns last N characters when len is provided', () => {
    mockRandomUUID.mockReturnValue('abcdef0123456789');

    expect(uuid(6)).toBe('456789');
  });
});
