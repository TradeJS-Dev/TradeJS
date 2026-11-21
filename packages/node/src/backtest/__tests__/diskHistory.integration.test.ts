import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndicators } from '@tradejs/core/indicators';
import { createDiskBacktestHistory } from '@tradejs/infra/backtestArtifacts';

it('matches the memory controller after old candle and resampling pages spill', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tradejs-disk-controller-'));
  const storage = createDiskBacktestHistory(directory);
  try {
    const memory = createIndicators([]);
    const disk = createIndicators([], [], { backtestHistory: storage });
    const candleAt = (index: number, price: number) => {
      const close = price + Math.sin(index / 9);
      const volume = 5 + (index % 11);
      return {
        timestamp: 1_700_000_100_000 + index * 900_000,
        open: close - 0.05,
        high: close + 0.1,
        low: close - 0.2,
        close,
        volume,
        turnover: close * volume,
        takerBuyBaseVolume: volume / 2,
      };
    };

    for (let i = 0; i < 2_200; i++) {
      const coin = candleAt(i, 20);
      const btc = candleAt(i, 100);
      const eth = candleAt(i, 40);
      const expected = memory.next(coin, btc, eth);
      const actual = disk.next(coin, btc, eth);
      if (i === 900 || i === 2_199) {
        expect(actual).toEqual(expected);
        expect(disk.checkpointRuntimeState()).toEqual(
          memory.checkpointRuntimeState(),
        );
      }
    }
    expect(readdirSync(directory)).toHaveLength(1);
    expect(disk.result()).toEqual(memory.result());
  } finally {
    storage.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
