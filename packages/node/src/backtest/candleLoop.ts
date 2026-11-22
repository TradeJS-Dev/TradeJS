import type { PreparedBacktestData } from './contracts';
import type { createBacktestProgress } from './progress';
import type { BacktestSession } from './session';

export const CLOSED_RESULT_FLUSH_INTERVAL = 500;

export const runBacktestCandleLoop = async (
  { testData, btcTestData }: PreparedBacktestData,
  session: BacktestSession,
  progress: Pick<
    ReturnType<typeof createBacktestProgress>,
    'checkpoint' | 'setCandle'
  >,
  predictNoSignal?: (index: number) => boolean,
) => {
  for (let candleIndex = 0; candleIndex < testData.length; candleIndex++) {
    if (candleIndex % 25 === 0) {
      progress.checkpoint('candle loop');
    }
    progress.setCandle(candleIndex + 1, testData.length);
    await session.next(
      testData[candleIndex],
      btcTestData[candleIndex],
      predictNoSignal?.(candleIndex)
        ? session.detectorNoSignalSkipReason
        : undefined,
    );

    if ((candleIndex + 1) % CLOSED_RESULT_FLUSH_INTERVAL === 0) {
      await session.flush();
    }
  }
};
