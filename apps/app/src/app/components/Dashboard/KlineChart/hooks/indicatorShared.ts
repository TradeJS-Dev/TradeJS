export const getCloseAtOrBefore = (
  candles: Array<{ timestamp: number; close: number }>,
  timestamp: number,
) => {
  let left = 0;
  let right = candles.length - 1;
  let result: number | undefined;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const candle = candles[mid];

    if (candle.timestamp <= timestamp) {
      result = candle.close;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

export const grayDashedLineStyle = () =>
  ({
    color: '#9ca3af',
    size: 1,
    style: 'dashed',
    dashedValue: [4, 4],
  }) as any;
