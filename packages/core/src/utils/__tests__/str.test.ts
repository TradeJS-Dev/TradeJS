import { escapeHtml } from '@utils/str';

describe('str utils', () => {
  describe('escapeHtml', () => {
    it('escapes ampersand, less-than and greater-than symbols', () => {
      expect(escapeHtml('a&b<c>d')).toBe('a&amp;b&lt;c&gt;d');
    });

    it('returns empty string for nullish and empty input', () => {
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml('')).toBe('');
    });
  });
});
