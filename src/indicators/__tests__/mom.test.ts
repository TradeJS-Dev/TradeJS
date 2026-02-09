import { MOM } from '../mom';

describe('MOM', () => {
  it('returns undefined until warmup and then momentum values', () => {
    const mom = new MOM({ period: 3, values: [] });

    expect(mom.nextValue(10)).toBeUndefined();
    expect(mom.nextValue(11)).toBeUndefined();
    expect(mom.nextValue(13)).toBeUndefined();
    expect(mom.nextValue(16)).toBe(6);
    expect(mom.nextValue(20)).toBe(9);
  });
});
