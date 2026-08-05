import { logger } from '@tradejs/infra/logger';
import type { Signal } from '@tradejs/types';
import { enrichSignalWithBinanceMarketContext } from './binanceMarketContext';
import { enrichSignalWithCoinMarketCapContext } from './coinMarketCapContext';
import { enrichSignalWithDerivativesContext } from './derivativesContext';
import { enrichSignalWithHyperliquidWhaleContext } from './hyperliquidWhaleContext';
import { isMarketContextCancellationError } from './marketContextErrors';

export type MarketContextEnrichmentStage =
  | 'binance'
  | 'coinmarketcap'
  | 'derivatives'
  | 'hyperliquidWhales';

export type MarketContextEnrichmentStageResult = {
  stage: MarketContextEnrichmentStage;
  status: 'available' | 'absent' | 'timed_out';
  elapsedMs: number;
};

const STAGE_ENV_KEYS: Record<MarketContextEnrichmentStage, string> = {
  binance: 'BINANCE_MARKET_CONTEXT_STAGE_TIMEOUT_MS',
  coinmarketcap: 'COINMARKETCAP_CONTEXT_STAGE_TIMEOUT_MS',
  derivatives: 'DERIVATIVES_CONTEXT_STAGE_TIMEOUT_MS',
  hyperliquidWhales: 'HYPERLIQUID_WHALE_CONTEXT_STAGE_TIMEOUT_MS',
};

const parsePositiveInt = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const resolveMarketContextStageTimeoutMs = (
  stage: MarketContextEnrichmentStage,
) =>
  parsePositiveInt(process.env[STAGE_ENV_KEYS[stage]]) ??
  parsePositiveInt(process.env.MARKET_CONTEXT_STAGE_TIMEOUT_MS) ??
  35_000;

const runMarketContextStage = async ({
  stage,
  parentSignal,
  operation,
  onStart,
  onComplete,
}: {
  stage: MarketContextEnrichmentStage;
  parentSignal?: AbortSignal;
  operation: (signal: AbortSignal) => Promise<boolean>;
  onStart?: (stage: MarketContextEnrichmentStage) => void;
  onComplete?: (result: MarketContextEnrichmentStageResult) => void;
}): Promise<MarketContextEnrichmentStageResult> => {
  const controller = new AbortController();
  const timeoutMs = resolveMarketContextStageTimeoutMs(stage);
  const startedAt = Date.now();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  if (parentSignal?.aborted) onParentAbort();
  onStart?.(stage);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    let available = false;
    try {
      available = await operation(controller.signal);
    } catch (error) {
      if (isMarketContextCancellationError(error)) {
        controller.abort(error);
      }
      if (!controller.signal.aborted) throw error;
    }
    const status = controller.signal.aborted
      ? 'timed_out'
      : available
        ? 'available'
        : 'absent';
    const result = {
      stage,
      status,
      elapsedMs: Date.now() - startedAt,
    } satisfies MarketContextEnrichmentStageResult;
    if (status === 'timed_out') {
      logger.warn(
        'Market context stage timed out: %s after %sms',
        stage,
        result.elapsedMs,
      );
    }
    onComplete?.(result);
    return result;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
};

export const enrichSignalWithMarketContextStages = async ({
  signal,
  env,
  coinMarketCapEnabled,
  includeHyperliquidWhales = true,
  abortSignal,
  onStageStart,
  onStageComplete,
}: {
  signal: Signal;
  env: string;
  coinMarketCapEnabled?: boolean;
  includeHyperliquidWhales?: boolean;
  abortSignal?: AbortSignal;
  onStageStart?: (stage: MarketContextEnrichmentStage) => void;
  onStageComplete?: (result: MarketContextEnrichmentStageResult) => void;
}): Promise<MarketContextEnrichmentStageResult[]> => {
  const stages: Array<{
    stage: MarketContextEnrichmentStage;
    operation: (stageSignal: AbortSignal) => Promise<boolean>;
  }> = [
    {
      stage: 'binance',
      operation: (stageSignal) =>
        enrichSignalWithBinanceMarketContext({
          signal,
          env,
          abortSignal: stageSignal,
        }),
    },
    {
      stage: 'coinmarketcap',
      operation: (stageSignal) =>
        enrichSignalWithCoinMarketCapContext({
          signal,
          env,
          enabled: coinMarketCapEnabled,
          abortSignal: stageSignal,
        }),
    },
    {
      stage: 'derivatives',
      operation: (stageSignal) =>
        enrichSignalWithDerivativesContext({
          signal,
          env,
          abortSignal: stageSignal,
        }),
    },
  ];

  if (includeHyperliquidWhales) {
    stages.push({
      stage: 'hyperliquidWhales',
      operation: (stageSignal) =>
        enrichSignalWithHyperliquidWhaleContext({
          signal,
          env,
          abortSignal: stageSignal,
        }),
    });
  }

  const results: MarketContextEnrichmentStageResult[] = [];
  for (const stage of stages) {
    if (abortSignal?.aborted) break;
    results.push(
      await runMarketContextStage({
        ...stage,
        parentSignal: abortSignal,
        onStart: onStageStart,
        onComplete: onStageComplete,
      }),
    );
  }
  return results;
};
