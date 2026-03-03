import { uuid } from '@utils/uuid';

const mockV4 = jest.fn();

jest.mock('uuid', () => ({
  v4: () => mockV4(),
}));

describe('uuid utils', () => {
  it('returns last 12 characters by default', () => {
    mockV4.mockReturnValue('12345678-1234-1234-1234-abcdefghijkl');

    expect(uuid()).toBe('1234-abcdefghijkl'.slice(-12));
  });

  it('returns last N characters when len is provided', () => {
    mockV4.mockReturnValue('abcdef0123456789');

    expect(uuid(6)).toBe('456789');
  });
});
