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

interface RuntimeCloseSink {
  current: (event: RuntimeStrategyCloseNotification) => void;
}

interface SignalsStrategyLifecycleEntry {
  strategy: Strategy;
  configFingerprint: string;
  lastTimestamp: number;
  processedBars: number;
  runtimeCloseSink: RuntimeCloseSink;
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
  symbol,
  interval,
  strategyName,
}: {
  connectorName: string;
  symbol: string;
  interval: string;
  strategyName: string;
}) => [connectorName, symbol, interval, strategyName].join(':');

export const createSignalsStrategyLifecycle = ({
  intervalMs,
  maxLiveBars,
}: {
  intervalMs: number;
  maxLiveBars: number;
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
      current.runtimeCloseSink.current = onRuntimeClose;
      (
        current.strategy as ReferenceAwareStrategy
      ).__tradejsUpdateReferenceData?.({
        btcBinanceData: btcBinanceData ?? [],
        btcCoinbaseData: btcCoinbaseData ?? [],
      });

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

    let entry = current;
    if (action !== 'reused') {
      const runtimeCloseSink: RuntimeCloseSink = { current: onRuntimeClose };
      const nextBtcBinanceData = [...(btcBinanceData ?? [])];
      const nextBtcCoinbaseData = [...(btcCoinbaseData ?? [])];
      const strategy = await create({
        btcBinanceData: nextBtcBinanceData,
        btcCoinbaseData: nextBtcCoinbaseData,
        onRuntimeClose: (event) => runtimeCloseSink.current(event),
      });
      entry = {
        strategy,
        configFingerprint,
        lastTimestamp: timestamp,
        processedBars: 0,
        runtimeCloseSink,
      };
      entries.set(key, entry);
    }
    if (!entry) {
      throw new Error(`Signals strategy lifecycle could not create ${key}`);
    }

    try {
      const result = await run(entry.strategy);
      entry.lastTimestamp = timestamp;
      entry.processedBars += 1;
      return { action, result };
    } catch (error) {
      entries.delete(key);
      throw error;
    }
  };

  return {
    evaluate,
    retain: (activeKeys) => {
      for (const key of entries.keys()) {
        if (!activeKeys.has(key)) {
          entries.delete(key);
        }
      }
    },
    clear: () => entries.clear(),
    size: () => entries.size,
  };
};
