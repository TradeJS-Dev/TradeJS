import { asPositiveInt, asPositiveNumber } from '../number';

describe('number utils', () => {
  it('asPositiveInt returns floored positive numbers', () => {
    expect(asPositiveInt(10.9, 1)).toBe(10);
    expect(asPositiveInt('5.7', 1)).toBe(5);
  });

  it('asPositiveInt returns fallback for invalid or non-positive values', () => {
    expect(asPositiveInt(0, 7)).toBe(7);
    expect(asPositiveInt(-3, 7)).toBe(7);
    expect(asPositiveInt('abc', 7)).toBe(7);
    expect(asPositiveInt(null, 7)).toBe(7);
  });

  it('asPositiveNumber returns positive numeric values as-is', () => {
    expect(asPositiveNumber(2.5, 1)).toBe(2.5);
    expect(asPositiveNumber('3.14', 1)).toBe(3.14);
  });

  it('asPositiveNumber returns fallback for invalid or non-positive values', () => {
    expect(asPositiveNumber(0, 9)).toBe(9);
    expect(asPositiveNumber(-1.1, 9)).toBe(9);
    expect(asPositiveNumber('nope', 9)).toBe(9);
    expect(asPositiveNumber(undefined, 9)).toBe(9);
  });
});
