import type { StrategyChartDetail } from '@tradejs/types';

const DIRECTION_DETAIL_PREFIX = 'direction:';
const SYMBOL_DETAIL_PREFIX = 'symbol:';

export const isDirectionDetail = (detail: StrategyChartDetail) =>
  detail.id.startsWith(DIRECTION_DETAIL_PREFIX);

export const isSymbolDetail = (detail: StrategyChartDetail) =>
  detail.id.startsWith(SYMBOL_DETAIL_PREFIX);

export const isStructuredDetail = (detail: StrategyChartDetail) =>
  isDirectionDetail(detail) || isSymbolDetail(detail);

export const getDetailById = (
  details: StrategyChartDetail[] | undefined,
  id: string,
) => details?.find((detail) => detail.id === id) ?? null;

export const parseFormattedNumber = (value: string) => {
  const normalized = value
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.+-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseConfusionDetail = (
  detail: StrategyChartDetail | null,
): number[] | null => {
  if (!detail) return null;
  const values = detail.value
    .split('/')
    .map((part) => parseFormattedNumber(part))
    .filter((value): value is number => value !== null);
  return values.length === 4 ? values : null;
};
