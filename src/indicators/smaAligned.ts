import { SMA } from 'technicalindicators';

export const smaAligned = (values: (number | undefined)[], len: number) => {
  const numeric = values.filter(
    (x): x is number => typeof x === 'number' && Number.isFinite(x),
  );
  const sma = SMA.calculate({ period: len, values: numeric });

  // Count undefined values before the first valid number + SMA warmup offset.
  const firstNumIdx = values.findIndex(
    (x) => typeof x === 'number' && Number.isFinite(x),
  );
  const prefix = (firstNumIdx === -1 ? values.length : firstNumIdx) + (len - 1);

  const out: (number | undefined)[] = Array(prefix).fill(undefined).concat(sma);
  if (out.length > values.length) out.length = values.length;
  while (out.length < values.length) out.push(undefined);
  return out;
};
