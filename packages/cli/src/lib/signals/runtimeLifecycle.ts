import type {
  KlineChartData,
  RuntimeStrategyCloseNotification,
  Strategy,
  StrategyConfig,
} from '@tradejs/types';

export type SignalsStrategyLifecycleAction =
  | 'created'
  | 'reused'
  | 'rebuilt_config'
  | 'rebuilt_gap'
  | 'rebuilt_limit'
  | 'duplicate'
  | 'stale';

export interface SignalsStrategyLifecycleResult {
  action: SignalsStrategyLifecycleAction;
  result?: Awaited<ReturnType<Strategy>>;
}

interface SignalsStrategyLifecycleEntry {
  configFingerprint: string;
  lastTimestamp: number;
  processedBars: number;
}

type ReferenceAwareStrategy = Strategy & {
  __tradejsUpdateReferenceData?: (params: {
    btcBinanceData: KlineChartData;
    btcCoinbaseData: KlineChartData;
  }) => void;
};

export interface EvaluateSignalsStrategyParams {
  key: string;
  timestamp: number;
  config: StrategyConfig;
  btcBinanceData?: KlineChartData;
  btcCoinbaseData?: KlineChartData;
  onRuntimeClose: (event: RuntimeStrategyCloseNotification) => void;
  create: (params: {
    btcBinanceData: KlineChartData;
    btcCoinbaseData: KlineChartData;
    onRuntimeClose: (event: RuntimeStrategyCloseNotification) => void;
  }) => Promise<Strategy>;
  run: (strategy: Strategy) => Promise<Awaited<ReturnType<Strategy>>>;
}

export interface SignalsStrategyLifecycle {
  evaluate: (
    params: EvaluateSignalsStrategyParams,
  ) => Promise<SignalsStrategyLifecycleResult>;
  retain: (activeKeys: ReadonlySet<string>) => void;
  clear: () => void;
  size: () => number;
}

const stableStringify = (value: unknown): string => {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
};

export const buildSignalsStrategyLifecycleKey = ({
  connectorName,
  universe,
  accountId,
  deploymentId,
  symbol,
  interval,
  strategyName,
  configId,
}: {
  connectorName: string;
  universe?: string;
  accountId?: string;
  deploymentId?: string;
  symbol: string;
  interval: string;
  strategyName: string;
  configId?: string;
}) => {
  const namedConfigId =
    configId && configId !== 'config' ? configId : undefined;
  if (!universe && !accountId && !deploymentId) {
    return [connectorName, symbol, interval, strategyName, namedConfigId]
      .filter(Boolean)
      .join(':');
  }
  return [
    connectorName,
    universe ?? 'crypto',
    accountId ?? 'default',
    deploymentId ?? 'default',
    symbol,
    interval,
    strategyName,
    namedConfigId,
  ]
    .filter(Boolean)
    .join(':');
};

export const createSignalsStrategyLifecycle = ({
  intervalMs,
  maxLiveBars,
  releaseState = () => undefined,
}: {
  intervalMs: number;
  maxLiveBars: number;
  releaseState?: (key: string) => void;
}): SignalsStrategyLifecycle => {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('Signals strategy lifecycle requires a positive interval');
  }
  if (!Number.isFinite(maxLiveBars) || maxLiveBars <= 0) {
    throw new Error('Signals strategy lifecycle requires positive maxLiveBars');
  }

  const normalizedMaxLiveBars = Math.max(1, Math.floor(maxLiveBars));
  const entries = new Map<string, SignalsStrategyLifecycleEntry>();

  const evaluate = async ({
    key,
    timestamp,
    config,
    btcBinanceData,
    btcCoinbaseData,
    onRuntimeClose,
    create,
    run,
  }: EvaluateSignalsStrategyParams): Promise<SignalsStrategyLifecycleResult> => {
    if (!Number.isFinite(timestamp)) {
      throw new Error(`Signals strategy lifecycle received ${timestamp}`);
    }

    const configFingerprint = stableStringify(config);
    const current = entries.get(key);
    if (current) {
      if (timestamp === current.lastTimestamp) {
        return { action: 'duplicate' };
      }
      if (timestamp < current.lastTimestamp) {
        return { action: 'stale' };
      }
    }

    let action: SignalsStrategyLifecycleAction = 'created';
    if (current && current.configFingerprint !== configFingerprint) {
      action = 'rebuilt_config';
    } else if (current && timestamp !== current.lastTimestamp + intervalMs) {
      action = 'rebuilt_gap';
    } else if (current && current.processedBars >= normalizedMaxLiveBars) {
      action = 'rebuilt_limit';
    } else if (current) {
      action = 'reused';
    }

    if (action.startsWith('rebuilt_')) {
      releaseState(key);
    }

    try {
      const strategy = await create({
        btcBinanceData: btcBinanceData ?? [],
        btcCoinbaseData: btcCoinbaseData ?? [],
        onRuntimeClose,
      });
      (strategy as ReferenceAwareStrategy).__tradejsUpdateReferenceData?.({
        btcBinanceData: btcBinanceData ?? [],
        btcCoinbaseData: btcCoinbaseData ?? [],
      });
      const result = await run(strategy);
      entries.set(key, {
        configFingerprint,
        lastTimestamp: timestamp,
        processedBars:
          (action === 'reused' ? current?.processedBars ?? 0 : 0) + 1,
      });
      return { action, result };
    } catch (error) {
      entries.delete(key);
      releaseState(key);
      throw error;
    }
  };

  return {
    evaluate,
    retain: (activeKeys) => {
      for (const key of entries.keys()) {
        if (!activeKeys.has(key)) {
          entries.delete(key);
          releaseState(key);
        }
      }
    },
    clear: () => {
      for (const key of entries.keys()) {
        releaseState(key);
      }
      entries.clear();
    },
    size: () => entries.size,
  };
};
