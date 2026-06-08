import type {
  StrategyChartDetail,
  StrategyChartMetric,
  StrategyChartSnapshot,
  StrategyChartsSnapshotResponse,
} from '@tradejs/types';
import {
  summarizeAiTrainEvaluations,
  type AiTrainEvaluation,
} from './aiTrainMetrics';

export type AiTrainEvaluatedRowForChart = AiTrainEvaluation & {
  signalId: string;
  symbol: string;
  strategy?: string;
  testName: string;
  configId: string;
  modelDirection: string | null;
  rawAiApproved?: boolean;
  sequence?: number;
};

const formatRatio = (value: number | null) =>
  value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const formatPercent = (value: number | null) =>
  value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const formatPercentValue = (value: number | null) =>
  value == null ? 'n/a' : `${value.toFixed(1)}%`;

const formatSigned = (value: number | null) =>
  value == null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

const formatNumber = (value: number | null) =>
  value == null ? 'n/a' : value.toFixed(2);

const formatUtcWindowTimestamp = (timestamp: number | null) => {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return 'n/a';
  }

  return new Date(timestamp)
    .toISOString()
    .replace('T', ' ')
    .replace('.000Z', ' UTC');
};

const resolveMetricTone = (
  value: number | null,
): StrategyChartMetric['tone'] => {
  if (value == null) {
    return 'default';
  }
  if (value > 0) {
    return 'success';
  }
  if (value < 0) {
    return 'error';
  }
  return 'warning';
};

const buildAiChartMetrics = (params: {
  summary: ReturnType<typeof summarizeAiTrainEvaluations>;
  maxDrawdownPercent: number | null;
}) => {
  const { summary, maxDrawdownPercent } = params;
  const metrics: StrategyChartMetric[] = [
    {
      id: 'maxDrawdown',
      label: 'Max drawdown',
      value: formatPercentValue(maxDrawdownPercent),
      tone:
        maxDrawdownPercent == null
          ? 'default'
          : maxDrawdownPercent > 0
            ? 'warning'
            : 'success',
    },
    {
      id: 'approved',
      label: 'Approved',
      value: String(summary.approved),
    },
    {
      id: 'accuracy',
      label: 'Accuracy',
      value: formatPercent(
        summary.correct + summary.incorrect > 0
          ? summary.correct / (summary.correct + summary.incorrect)
          : null,
      ),
    },
    {
      id: 'precision',
      label: 'Precision',
      value: formatPercent(summary.precisionApproved),
    },
    {
      id: 'recall',
      label: 'Recall',
      value: formatPercent(summary.recallWinners),
    },
    {
      id: 'pnl',
      label: 'P&L',
      value: formatSigned(summary.approvedRisk.totalProfit),
      tone: resolveMetricTone(summary.approvedRisk.totalProfit),
    },
    {
      id: 'monthlyPnl',
      label: 'Monthly P&L',
      value: formatSigned(summary.avgProfitApprovedPerMonth),
      tone: resolveMetricTone(summary.avgProfitApprovedPerMonth),
    },
    {
      id: 'approvedPerDay',
      label: 'Approved/Day',
      value: formatNumber(summary.avgApprovedTradesPerDay),
    },
    {
      id: 'avgProfit',
      label: 'Avg Profit',
      value: formatSigned(summary.avgProfitApproved),
      tone: resolveMetricTone(summary.avgProfitApproved),
    },
  ];

  return metrics;
};

const buildAiChartDetails = (params: {
  summary: ReturnType<typeof summarizeAiTrainEvaluations>;
  rows: AiTrainEvaluatedRowForChart[];
}) => {
  const { summary, rows } = params;
  let windowStart: number | null = null;
  let windowEnd: number | null = null;
  for (const row of rows) {
    const timestamp =
      row.timestamp != null && Number.isFinite(row.timestamp)
        ? row.timestamp
        : null;
    if (timestamp == null) {
      continue;
    }

    if (windowStart == null || timestamp < windowStart) {
      windowStart = timestamp;
    }
    if (windowEnd == null || timestamp > windowEnd) {
      windowEnd = timestamp;
    }
  }

  const details: StrategyChartDetail[] = [
    {
      id: 'window',
      label: 'window',
      value: `${formatUtcWindowTimestamp(windowStart)} -> ${formatUtcWindowTimestamp(windowEnd)}`,
    },
    {
      id: 'approved',
      label: 'approved',
      value: String(summary.approved),
    },
    {
      id: 'confusion',
      label: 'TP / FP / TN / FN',
      value: `${summary.truePositive} / ${summary.falsePositive} / ${summary.trueNegative} / ${summary.falseNegative}`,
    },
    {
      id: 'precisionApproved',
      label: 'precision_approved',
      value: formatRatio(summary.precisionApproved),
    },
    {
      id: 'recallWinners',
      label: 'recall_winners',
      value: formatRatio(summary.recallWinners),
    },
    {
      id: 'avgProfitAll',
      label: 'avg_profit_all',
      value: formatSigned(summary.avgProfitAll),
      tone: resolveMetricTone(summary.avgProfitAll),
    },
    {
      id: 'avgProfitApproved',
      label: 'avg_profit_approved',
      value: formatSigned(summary.avgProfitApproved),
      tone: resolveMetricTone(summary.avgProfitApproved),
    },
    {
      id: 'avgProfitApprovedPerDay',
      label: 'avg_profit_approved_per_day',
      value: formatSigned(summary.avgProfitApprovedPerDay),
      tone: resolveMetricTone(summary.avgProfitApprovedPerDay),
    },
    {
      id: 'avgProfitApprovedPerMonth',
      label: 'avg_profit_approved_per_month',
      value: formatSigned(summary.avgProfitApprovedPerMonth),
      tone: resolveMetricTone(summary.avgProfitApprovedPerMonth),
    },
    {
      id: 'avgApprovedTradesPerDay',
      label: 'avg_approved_trades_per_day',
      value: formatNumber(summary.avgApprovedTradesPerDay),
    },
    {
      id: 'avgApprovedTradesPerWeek',
      label: 'avg_approved_trades_per_week',
      value: formatNumber(summary.avgApprovedTradesPerWeek),
    },
    {
      id: 'expectancyDelta',
      label: 'expectancy_delta',
      value: formatSigned(summary.expectancyDelta),
      tone: resolveMetricTone(summary.expectancyDelta),
    },
  ];

  return details;
};

const buildStrategyWideEquityCurve = (
  evaluations: AiTrainEvaluatedRowForChart[],
) => {
  if (!evaluations.length) {
    return [] as Array<[number, number]>;
  }

  const sorted = [...evaluations].sort(
    (left, right) =>
      (left.timestamp ?? 0) - (right.timestamp ?? 0) ||
      left.symbol.localeCompare(right.symbol) ||
      left.signalId.localeCompare(right.signalId),
  );
  let amount = 100;
  const firstTimestamp = sorted[0]?.timestamp ?? Date.now();
  const orderLog: Array<[number, number]> = [[firstTimestamp, amount]];

  for (const evaluation of sorted) {
    amount += evaluation.profit;
    orderLog.push([
      evaluation.timestamp ?? firstTimestamp,
      Number(amount.toFixed(4)),
    ]);
  }

  if (orderLog.length === 1) {
    orderLog.push([firstTimestamp, amount]);
  }

  return orderLog;
};

const calculateMaxDrawdownPercent = (orderLog: Array<[number, number]>) => {
  if (!orderLog.length) {
    return null;
  }

  let peak = orderLog[0]?.[1] ?? 0;
  let maxDrawdownPercent = 0;

  for (const [, amount] of orderLog) {
    if (!Number.isFinite(amount)) {
      continue;
    }

    peak = Math.max(peak, amount);
    if (peak <= 0) {
      continue;
    }

    const drawdownPercent = ((peak - amount) / peak) * 100;
    maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
  }

  return Number(maxDrawdownPercent.toFixed(1));
};

const resolveAiVariantGroup = (params: { configId: string }) => {
  const normalizedConfigId = params.configId.trim();
  if (!normalizedConfigId) {
    return null;
  }

  return {
    key: normalizedConfigId,
    label: `config ${normalizedConfigId}`,
  };
};

export const buildAiChartSnapshot = (params: {
  evaluatedRows: AiTrainEvaluatedRowForChart[];
  strategyName: string;
  generatedAt: number;
  runLabel: string;
  minQuality: number;
  datasetId?: string;
}) => {
  const {
    evaluatedRows,
    strategyName,
    generatedAt,
    runLabel,
    minQuality,
    datasetId,
  } = params;
  const groupsByVariant = new Map<
    string,
    {
      key: string;
      label: string;
      rows: AiTrainEvaluatedRowForChart[];
    }
  >();

  for (const evaluation of evaluatedRows) {
    const variantGroup = resolveAiVariantGroup({
      configId: evaluation.configId,
    });
    if (!variantGroup) {
      continue;
    }

    const existingGroup = groupsByVariant.get(variantGroup.key);
    if (existingGroup) {
      existingGroup.rows.push(evaluation);
      continue;
    }

    groupsByVariant.set(variantGroup.key, {
      key: variantGroup.key,
      label: variantGroup.label,
      rows: [evaluation],
    });
  }

  const variantGroups = [...groupsByVariant.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
  const groupByVariant = variantGroups.length > 1;
  const groups = groupByVariant
    ? variantGroups
    : [
        {
          key: strategyName,
          label: '',
          rows: evaluatedRows,
        },
      ];

  const cards: StrategyChartSnapshot[] = [];
  for (const threshold of [minQuality]) {
    for (const group of groups) {
      const thresholdEvaluations = group.rows.map((evaluation) => ({
        ...evaluation,
        aiApproved:
          evaluation.modelDirection === evaluation.direction &&
          evaluation.quality != null &&
          evaluation.quality >= threshold,
      }));
      const summary = summarizeAiTrainEvaluations(thresholdEvaluations);
      const approvedRows = thresholdEvaluations.filter(
        (evaluation) => evaluation.aiApproved,
      );
      const orderLog = buildStrategyWideEquityCurve(approvedRows);

      cards.push({
        cardId: `${strategyName}-${group.key}-q${threshold}-${generatedAt}`,
        generatedAt,
        strategyName,
        title: groupByVariant
          ? `${strategyName} · ${group.label}`
          : strategyName,
        subtitle: runLabel ? `q${threshold}+ · ${runLabel}` : `q${threshold}+`,
        datasetId,
        symbols: [
          ...new Set(
            group.rows.map((evaluation) => evaluation.symbol).filter(Boolean),
          ),
        ].sort(),
        orderLog,
        stat: null,
        metrics: buildAiChartMetrics({
          summary,
          maxDrawdownPercent: calculateMaxDrawdownPercent(orderLog),
        }),
        details: buildAiChartDetails({
          summary,
          rows: thresholdEvaluations,
        }),
        tags: groupByVariant
          ? [`q${threshold}+`, group.label]
          : [`q${threshold}+`],
      });
    }
  }

  return {
    mode: 'ai',
    generatedAt,
    runLabel,
    strategies: cards,
  } satisfies StrategyChartsSnapshotResponse;
};
