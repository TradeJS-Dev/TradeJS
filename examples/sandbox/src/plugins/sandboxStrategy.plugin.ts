import { defineStrategyPlugin } from '@tradejs/core/config';
import {
  createStrategyConfigParser,
  type ValidatedStrategyRegistryEntry,
} from '@tradejs/strategy-kit/config';
import {
  type CreateStrategyCore,
  type Signal,
  type StrategyConfig,
  type StrategyManifest,
} from '@tradejs/types';

const STRATEGY_NAME = 'SandboxDeterministicSignal';

interface SandboxStrategyConfig extends StrategyConfig {
  INTERVAL?: Signal['interval'];
  SANDBOX_ENTRY_EVERY_BARS?: number;
  SANDBOX_QTY?: number;
  SANDBOX_TP_PCT?: number;
  SANDBOX_SL_PCT?: number;
}

const DEFAULT_CONFIG: SandboxStrategyConfig = {
  INTERVAL: '15',
  SANDBOX_ENTRY_EVERY_BARS: 96,
  SANDBOX_QTY: 1,
  SANDBOX_TP_PCT: 0.4,
  SANDBOX_SL_PCT: 1,
};

const createSandboxDeterministicCore: CreateStrategyCore<
  SandboxStrategyConfig
> = async ({ data, config, strategyApi }) => {
  const entryEveryBars = Math.max(
    1,
    Math.floor(Number(config.SANDBOX_ENTRY_EVERY_BARS ?? 96)),
  );
  const qty = Number(config.SANDBOX_QTY ?? 1);
  const tpPct = Number(config.SANDBOX_TP_PCT ?? 0.4);
  const slPct = Number(config.SANDBOX_SL_PCT ?? 1);

  return async (candle) => {
    const previousCandle = data[data.length - 2];

    if (!previousCandle || previousCandle.close <= 0) {
      return strategyApi.skip('SANDBOX_WAIT_PREV_CANDLE');
    }

    if (qty <= 0) {
      return strategyApi.skip('SANDBOX_INVALID_QTY');
    }

    const inPosition = await strategyApi.getCurrentPosition();
    if (inPosition) {
      return strategyApi.skip('SANDBOX_POSITION_EXISTS');
    }

    if (data.length % entryEveryBars !== 0) {
      return strategyApi.skip('SANDBOX_WAIT_ENTRY_SLOT');
    }

    const movePct =
      ((candle.close - previousCandle.close) / previousCandle.close) * 100;
    const { currentPrice, timestamp } =
      await strategyApi.getDecisionPriceContext();
    const takeProfitPrice = currentPrice * (1 + tpPct / 100);
    const stopLossPrice = currentPrice * (1 - slPct / 100);

    return strategyApi.entry({
      code: 'SANDBOX_DETERMINISTIC_ENTRY',
      direction: 'LONG',
      signalId: `sandbox-deterministic-${timestamp}`,
      figures: {
        points: [
          {
            id: 'sandbox-entry',
            kind: 'entry',
            points: [{ timestamp, value: currentPrice }],
            color: '#22c55e',
            radius: 3,
          },
        ],
      },
      indicators: {
        sandboxMovePct: movePct,
        sandboxEntrySlot: true,
      },
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [
          {
            price: takeProfitPrice,
            rate: 1,
          },
        ],
      },
    });
  };
};

const sandboxManifest: StrategyManifest = {
  name: STRATEGY_NAME,
};

const sandboxStrategyEntry: ValidatedStrategyRegistryEntry<SandboxStrategyConfig> =
  {
    defaults: DEFAULT_CONFIG,
    parseConfig: createStrategyConfigParser({
      strategyName: STRATEGY_NAME,
      defaults: DEFAULT_CONFIG,
    }),
    manifest: sandboxManifest,
    createCore: createSandboxDeterministicCore,
  };

const strategyEntries = defineStrategyPlugin({
  strategyEntries: [sandboxStrategyEntry],
}).strategyEntries;

export { STRATEGY_NAME, strategyEntries, createSandboxDeterministicCore };

export default defineStrategyPlugin({ strategyEntries });
