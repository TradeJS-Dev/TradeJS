import type { StrategyChartDetail, StrategyChartMetric } from '@tradejs/types';
import { formatInteger } from '#components/Shared/OrdersDrawer';
import {
  getDetailById,
  isStructuredDetail,
  parseConfusionDetail,
} from './StrategySnapshotCard.details.presenter';

const AI_STAT_DIRECTIONS = ['LONG', 'SHORT'] as const;
type AiStatDirection = (typeof AI_STAT_DIRECTIONS)[number];

export interface DirectionMetric {
  id: string;
  label: string;
  value: string;
  tone?: StrategyChartMetric['tone'];
}

export interface DirectionStatGroup {
  direction: AiStatDirection;
  metrics: DirectionMetric[];
  hasData: boolean;
}

export interface AiDiagnosticMetric {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: StrategyChartMetric['tone'];
}

export interface AiDiagnosticGroup {
  id: string;
  title: string;
  description: string;
  columns: 1 | 2 | 4;
  metrics: AiDiagnosticMetric[];
}

export const getMetricColor = (tone: StrategyChartMetric['tone']) => {
  switch (tone) {
    case 'success':
      return 'teal.500';
    case 'warning':
      return 'fg.warning';
    case 'neutral':
      return 'gray.300';
    case 'error':
      return 'fg.error';
    default:
      return 'gray.200';
  }
};

const directionMetricLabels: Record<string, string> = {
  approved: 'Approved',
  precision: 'Precision',
  monthlyPnl: 'Monthly P&L',
  pnl: 'P&L',
  avgProfit: 'Avg Profit',
};

const directionMetricOrder = [
  'approved',
  'precision',
  'monthlyPnl',
  'pnl',
  'avgProfit',
] as const;

const aiDrawerMetricOrder = [
  'monthlyPnl',
  'avgProfit',
  'maxDrawdown',
  'maxLossStreak',
  'approved',
  'approvedPerDay',
  'accuracy',
  'precision',
] as const;

const aiDrawerMetricOrderIndex = new Map<string, number>(
  aiDrawerMetricOrder.map((metricId, index) => [metricId, index]),
);

export const sortAiDrawerMetrics = (metrics: StrategyChartMetric[]) =>
  metrics
    .filter((metric) => metric.id !== 'recall')
    .sort((left, right) => {
      const leftIndex = aiDrawerMetricOrderIndex.get(left.id) ?? 100;
      const rightIndex = aiDrawerMetricOrderIndex.get(right.id) ?? 100;

      return leftIndex - rightIndex || left.label.localeCompare(right.label);
    });

export const getPnlBarColor = (value: number) => {
  if (value > 0) {
    return 'teal.500';
  }
  if (value < 0) {
    return 'red.500';
  }
  return 'gray.500';
};

export const buildDirectionStatGroups = (
  details: StrategyChartDetail[] | undefined,
): DirectionStatGroup[] => {
  const grouped = new Map<AiStatDirection, Map<string, DirectionMetric>>();

  for (const direction of AI_STAT_DIRECTIONS) {
    grouped.set(direction, new Map());
  }

  for (const detail of details ?? []) {
    const [, direction, metricId] = detail.id.split(':');
    if (metricId == null) {
      continue;
    }

    if (direction !== 'LONG' && direction !== 'SHORT') {
      continue;
    }

    const metric: DirectionMetric = {
      id: metricId,
      label: directionMetricLabels[metricId] ?? detail.label,
      value: detail.value,
    };
    if (detail.tone) {
      metric.tone = detail.tone;
    }

    grouped.get(direction)?.set(metricId, metric);
  }

  return AI_STAT_DIRECTIONS.map((direction) => {
    const values = grouped.get(direction) ?? new Map<string, DirectionMetric>();
    const metrics = directionMetricOrder.map(
      (metricId): DirectionMetric =>
        values.get(metricId) ?? {
          id: metricId,
          label: directionMetricLabels[metricId],
          value: 'n/a',
          tone: 'default',
        },
    );

    return {
      direction,
      metrics,
      hasData: values.size > 0,
    };
  });
};

export const buildAiDiagnosticGroups = (
  details: StrategyChartDetail[] | undefined,
): AiDiagnosticGroup[] => {
  const plainDetails = details?.filter((detail) => !isStructuredDetail(detail));
  const groups: AiDiagnosticGroup[] = [];
  const windowDetail = getDetailById(plainDetails, 'window');
  const confusion = parseConfusionDetail(
    getDetailById(plainDetails, 'confusion'),
  );
  const avgProfitAll = getDetailById(plainDetails, 'avgProfitAll');
  const expectancyDelta = getDetailById(plainDetails, 'expectancyDelta');

  if (windowDetail) {
    groups.push({
      id: 'window',
      title: 'Evaluation window',
      description: 'source rows used for this AI snapshot',
      columns: 1,
      metrics: [
        {
          id: windowDetail.id,
          label: 'Window',
          value: windowDetail.value,
          detail: 'UTC range',
          tone: windowDetail.tone,
        },
      ],
    });
  }

  if (confusion) {
    const [truePositive, falsePositive, trueNegative, falseNegative] =
      confusion;

    groups.push({
      id: 'confusion',
      title: 'Decision matrix',
      description: 'approved vs blocked outcomes',
      columns: 4,
      metrics: [
        {
          id: 'truePositive',
          label: 'TP',
          value: formatInteger(truePositive),
          detail: 'winner approved',
          tone: 'success',
        },
        {
          id: 'falsePositive',
          label: 'FP',
          value: formatInteger(falsePositive),
          detail: 'loser approved',
          tone: falsePositive > 0 ? 'warning' : 'neutral',
        },
        {
          id: 'trueNegative',
          label: 'TN',
          value: formatInteger(trueNegative),
          detail: 'loser blocked',
          tone: 'success',
        },
        {
          id: 'falseNegative',
          label: 'FN',
          value: formatInteger(falseNegative),
          detail: 'winner blocked',
          tone: falseNegative > 0 ? 'warning' : 'neutral',
        },
      ],
    });
  }

  const liftMetrics: AiDiagnosticMetric[] = [];

  if (avgProfitAll) {
    liftMetrics.push({
      id: avgProfitAll.id,
      label: 'Avg all candidates',
      value: avgProfitAll.value,
      detail: 'before AI approval',
      tone: avgProfitAll.tone,
    });
  }

  if (expectancyDelta) {
    liftMetrics.push({
      id: expectancyDelta.id,
      label: 'Expectancy lift',
      value: expectancyDelta.value,
      detail: 'approved avg minus all avg',
      tone: expectancyDelta.tone,
    });
  }

  if (liftMetrics.length) {
    groups.push({
      id: 'lift',
      title: 'Gate lift',
      description: 'what approval changes',
      columns: 2,
      metrics: liftMetrics,
    });
  }

  return groups;
};
