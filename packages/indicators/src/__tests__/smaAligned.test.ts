import { smaAligned } from '../smaAligned';

describe('smaAligned', () => {
  it('preserves alignment with leading undefined values', () => {
    const input = [undefined, undefined, 1, 2, 3, 4];
    const output = smaAligned(input, 2);

    expect(output).toEqual([undefined, undefined, undefined, 1.5, 2.5, 3.5]);
  });

  it('returns array of undefined when there are no numeric values', () => {
    const input = [undefined, undefined, undefined];
    const output = smaAligned(input, 3);

    expect(output).toEqual([undefined, undefined, undefined]);
  });

  it('keeps output length equal to input length', () => {
    const input = [1];
    const output = smaAligned(input, 3);

    expect(output).toHaveLength(1);
    expect(output).toEqual([undefined]);
  });
});
