import { toJson } from '@utils/toJson';

describe('toJson utils', () => {
  it('serializes object in compact mode by default', () => {
    expect(toJson({ a: 1, b: true })).toBe('{"a":1,"b":true}');
  });

  it('serializes object in pretty mode with indentation', () => {
    expect(toJson({ a: 1 }, true)).toBe('{\n  "a": 1\n}');
  });
});
