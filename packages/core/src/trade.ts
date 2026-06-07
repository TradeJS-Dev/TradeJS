const ORDER_LINK_PREFIX = 'tjs-';
const ORDER_LINK_SEPARATOR = '--';
const STRATEGY_SLUG_LENGTH = 10;
const STRATEGY_HASH_LENGTH = 5;

export {
  applyExecutionSlippage,
  calculateEffectiveSlippageBps,
  extractExecutionMarketImpactBps,
  extractExecutionSpreadBps,
  slippageBpsToRate,
  type ApplyExecutionSlippageParams,
  type ExecutionSlippageDirection,
  type ExecutionSlippageModelParams,
  type ExecutionSlippageStage,
} from './utils/executionSlippage';

const toBase36Hash = (value: string) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36).padStart(STRATEGY_HASH_LENGTH, '0');
};

export const normalizeStrategyOrderLinkKey = (
  strategyName: string | null | undefined,
) => {
  const normalized = String(strategyName ?? '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  const slug =
    normalized.replace(/[^a-z0-9]+/g, '').slice(0, STRATEGY_SLUG_LENGTH) ||
    'strategy';
  const hash = toBase36Hash(normalized).slice(0, STRATEGY_HASH_LENGTH);

  return `${slug}-${hash}`;
};

export const createRuntimeOrderLinkPrefix = (
  strategyName: string | null | undefined,
) => {
  const strategyKey = normalizeStrategyOrderLinkKey(strategyName);
  return strategyKey
    ? `${ORDER_LINK_PREFIX}${strategyKey}${ORDER_LINK_SEPARATOR}`
    : ORDER_LINK_PREFIX;
};

export const parseStrategyOrderLinkKey = (
  orderLinkId: string | null | undefined,
) => {
  const normalized = String(orderLinkId ?? '')
    .trim()
    .toLowerCase();

  if (!normalized.startsWith(ORDER_LINK_PREFIX)) {
    return null;
  }

  const remainder = normalized.slice(ORDER_LINK_PREFIX.length);
  const separatorIndex = remainder.indexOf(ORDER_LINK_SEPARATOR);

  if (separatorIndex <= 0) {
    return null;
  }

  const strategyPart = remainder.slice(0, separatorIndex).trim();

  if (!strategyPart) {
    return null;
  }

  return strategyPart;
};
