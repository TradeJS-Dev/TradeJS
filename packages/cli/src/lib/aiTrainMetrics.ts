export type AiTrainEvaluation = {
  profit: number;
  profitableTrade: boolean;
  aiApproved: boolean;
  quality: number | null;
  modelDirectionMatches?: boolean | null;
  direction?: string | null;
  timestamp?: number | null;
};

export type AiTrainQualityBucket = {
  quality: number | null;
  count: number;
  approved: number;
  profitable: number;
  totalProfit: number;
};

export type AiTrainRiskSummary = {
  trades: number;
  totalProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  payoffRatio: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  winRate: number | null;
  maxDrawdown: number;
  maxDrawdownPctOfGrossProfit: number | null;
  maxDrawdownPctOfTotalProfit: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  recoveryFactor: number | null;
  ulcerIndex: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
};

export type AiTrainSummary = {
  approved: number;
  rejected: number;
  correct: number;
  incorrect: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  profitable: number;
  unprofitable: number;
  flat: number;
  precisionApproved: number | null;
  recallWinners: number | null;
  avgProfitAll: number | null;
  avgProfitApproved: number | null;
  avgProfitApprovedPerDay: number | null;
  avgProfitApprovedPerMonth: number | null;
  avgApprovedTradesPerDay: number | null;
  avgApprovedTradesPerWeek: number | null;
  expectancyDelta: number | null;
  approvedRisk: AiTrainRiskSummary;
  qualityBuckets: AiTrainQualityBucket[];
};

export type AiTrainDirectionSummary = {
  direction: string;
  summary: AiTrainSummary;
};

export type AiTrainMonthlySummary = {
  month: string;
  summary: AiTrainSummary;
};

export type AiTrainQualityThresholdSummary = {
  threshold: number;
  label: string;
  summary: AiTrainSummary;
};

const divideOrNull = (num: number, denom: number) => {
  if (denom <= 0) {
    return null;
  }
  return num / denom;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30.4375;
const DAYS_PER_YEAR = 365;

const getEvaluationPeriodDays = (evaluations: AiTrainEvaluation[]) => {
  let minTimestamp: number | null = null;
  let maxTimestamp: number | null = null;

  for (const evaluation of evaluations) {
    const timestamp =
      typeof evaluation.timestamp === 'number' &&
      Number.isFinite(evaluation.timestamp)
        ? evaluation.timestamp
        : null;
    if (timestamp == null) {
      continue;
    }

    if (minTimestamp == null || timestamp < minTimestamp) {
      minTimestamp = timestamp;
    }
    if (maxTimestamp == null || timestamp > maxTimestamp) {
      maxTimestamp = timestamp;
    }
  }

  if (minTimestamp == null || maxTimestamp == null) {
    return null;
  }

  return Math.max((maxTimestamp - minTimestamp) / DAY_MS, 1);
};

const qualitySortKey = (quality: number | null) =>
  quality == null ? Number.POSITIVE_INFINITY : quality;

const calculateTradePnlRiskRatios = ({
  profits,
  totalProfit,
  maxDrawdown,
  periodDays,
}: {
  profits: number[];
  totalProfit: number;
  maxDrawdown: number;
  periodDays: number | null;
}): Pick<
  AiTrainRiskSummary,
  'sharpeRatio' | 'sortinoRatio' | 'calmarRatio'
> => {
  if (!profits.length || periodDays == null || periodDays <= 0) {
    return {
      sharpeRatio: null,
      sortinoRatio: null,
      calmarRatio: null,
    };
  }

  const meanProfit = totalProfit / profits.length;
  const variance =
    profits.reduce((sum, profit) => {
      const diff = profit - meanProfit;
      return sum + diff * diff;
    }, 0) / profits.length;
  const stdDev = Math.sqrt(variance);
  const downsideDeviation = Math.sqrt(
    profits.reduce(
      (sum, profit) => (profit < 0 ? sum + profit * profit : sum),
      0,
    ) / profits.length,
  );
  const annualizationScale = Math.sqrt(
    (profits.length / periodDays) * DAYS_PER_YEAR,
  );

  return {
    sharpeRatio:
      stdDev > 0 && annualizationScale > 0
        ? (meanProfit / stdDev) * annualizationScale
        : null,
    sortinoRatio:
      downsideDeviation > 0 && annualizationScale > 0
        ? (meanProfit / downsideDeviation) * annualizationScale
        : null,
    calmarRatio:
      maxDrawdown > 0
        ? ((totalProfit / periodDays) * DAYS_PER_YEAR) / maxDrawdown
        : null,
  };
};

const emptyRiskSummary = (): AiTrainRiskSummary => ({
  trades: 0,
  totalProfit: 0,
  grossProfit: 0,
  grossLoss: 0,
  profitFactor: null,
  payoffRatio: null,
  avgWin: null,
  avgLoss: null,
  largestWin: null,
  largestLoss: null,
  winRate: null,
  maxDrawdown: 0,
  maxDrawdownPctOfGrossProfit: null,
  maxDrawdownPctOfTotalProfit: null,
  sharpeRatio: null,
  sortinoRatio: null,
  calmarRatio: null,
  recoveryFactor: null,
  ulcerIndex: null,
  maxConsecutiveWins: 0,
  maxConsecutiveLosses: 0,
});

const summarizeApprovedRisk = (
  evaluations: AiTrainEvaluation[],
  periodDays = getEvaluationPeriodDays(evaluations),
): AiTrainRiskSummary => {
  const approvedEvaluations = evaluations
    .filter((evaluation) => evaluation.aiApproved)
    .sort((left, right) => {
      const leftTimestamp =
        typeof left.timestamp === 'number' && Number.isFinite(left.timestamp)
          ? left.timestamp
          : Number.POSITIVE_INFINITY;
      const rightTimestamp =
        typeof right.timestamp === 'number' && Number.isFinite(right.timestamp)
          ? right.timestamp
          : Number.POSITIVE_INFINITY;
      return leftTimestamp - rightTimestamp;
    });

  if (!approvedEvaluations.length) {
    return emptyRiskSummary();
  }

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let largestWin: number | null = null;
  let largestLoss: number | null = null;
  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  let drawdownSquares = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  const approvedProfits: number[] = [];

  for (const evaluation of approvedEvaluations) {
    const profit = evaluation.profit;
    approvedProfits.push(profit);

    if (profit > 0) {
      grossProfit += profit;
      wins += 1;
      largestWin = largestWin == null ? profit : Math.max(largestWin, profit);
      currentWinStreak += 1;
      currentLossStreak = 0;
    } else if (profit < 0) {
      grossLoss += Math.abs(profit);
      losses += 1;
      largestLoss =
        largestLoss == null ? profit : Math.min(largestLoss, profit);
      currentLossStreak += 1;
      currentWinStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);

    equity += profit;
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = Math.max(0, peakEquity - equity);
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    drawdownSquares += drawdown * drawdown;
  }

  const totalProfit = grossProfit - grossLoss;
  const avgWin = divideOrNull(grossProfit, wins);
  const avgLoss = divideOrNull(grossLoss, losses);
  const riskRatios = calculateTradePnlRiskRatios({
    profits: approvedProfits,
    totalProfit,
    maxDrawdown,
    periodDays,
  });

  return {
    trades: approvedEvaluations.length,
    totalProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    payoffRatio:
      avgWin != null && avgLoss != null && avgLoss > 0
        ? avgWin / avgLoss
        : null,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    winRate: divideOrNull(wins, approvedEvaluations.length),
    maxDrawdown,
    maxDrawdownPctOfGrossProfit:
      grossProfit > 0 ? maxDrawdown / grossProfit : null,
    maxDrawdownPctOfTotalProfit:
      totalProfit > 0 ? maxDrawdown / totalProfit : null,
    ...riskRatios,
    recoveryFactor: maxDrawdown > 0 ? totalProfit / maxDrawdown : null,
    ulcerIndex: Math.sqrt(drawdownSquares / approvedEvaluations.length),
    maxConsecutiveWins,
    maxConsecutiveLosses,
  };
};

export const summarizeAiTrainEvaluations = (
  evaluations: AiTrainEvaluation[],
): AiTrainSummary => {
  let approved = 0;
  let rejected = 0;
  let correct = 0;
  let incorrect = 0;
  let profitable = 0;
  let unprofitable = 0;
  let flat = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let totalProfitAll = 0;
  let totalProfitApproved = 0;
  const bucketMap = new Map<number | null, AiTrainQualityBucket>();

  for (const evaluation of evaluations) {
    const { profit, profitableTrade, aiApproved, quality } = evaluation;
    totalProfitAll += profit;

    if (profitableTrade) {
      profitable += 1;
    } else if (profit < 0) {
      unprofitable += 1;
    } else {
      flat += 1;
    }

    if (aiApproved) {
      approved += 1;
      totalProfitApproved += profit;
    } else {
      rejected += 1;
    }

    const isCorrect = aiApproved === profitableTrade;
    if (isCorrect) {
      correct += 1;
    } else {
      incorrect += 1;
    }

    if (aiApproved && profitableTrade) {
      truePositive += 1;
    } else if (aiApproved && !profitableTrade) {
      falsePositive += 1;
    } else if (!aiApproved && profitableTrade) {
      falseNegative += 1;
    } else {
      trueNegative += 1;
    }

    const bucket =
      bucketMap.get(quality) ??
      ({
        quality,
        count: 0,
        approved: 0,
        profitable: 0,
        totalProfit: 0,
      } satisfies AiTrainQualityBucket);
    bucket.count += 1;
    bucket.totalProfit += profit;
    if (aiApproved) {
      bucket.approved += 1;
    }
    if (profitableTrade) {
      bucket.profitable += 1;
    }
    bucketMap.set(quality, bucket);
  }

  const avgProfitAll = divideOrNull(totalProfitAll, evaluations.length);
  const avgProfitApproved = divideOrNull(totalProfitApproved, approved);
  const periodDays = getEvaluationPeriodDays(evaluations);
  const avgProfitApprovedPerDay =
    periodDays == null ? null : divideOrNull(totalProfitApproved, periodDays);
  const avgApprovedTradesPerDay =
    periodDays == null ? null : divideOrNull(approved, periodDays);
  const avgProfitApprovedPerMonth =
    avgProfitApprovedPerDay == null
      ? null
      : avgProfitApprovedPerDay * DAYS_PER_MONTH;
  const avgApprovedTradesPerWeek =
    avgApprovedTradesPerDay == null
      ? null
      : avgApprovedTradesPerDay * DAYS_PER_WEEK;
  const expectancyDelta =
    avgProfitAll == null || avgProfitApproved == null
      ? null
      : avgProfitApproved - avgProfitAll;

  return {
    approved,
    rejected,
    correct,
    incorrect,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    profitable,
    unprofitable,
    flat,
    precisionApproved: divideOrNull(truePositive, approved),
    recallWinners: divideOrNull(truePositive, profitable),
    avgProfitAll,
    avgProfitApproved,
    avgProfitApprovedPerDay,
    avgProfitApprovedPerMonth,
    avgApprovedTradesPerDay,
    avgApprovedTradesPerWeek,
    expectancyDelta,
    approvedRisk: summarizeApprovedRisk(evaluations, periodDays),
    qualityBuckets: [...bucketMap.values()].sort(
      (a, b) => qualitySortKey(a.quality) - qualitySortKey(b.quality),
    ),
  };
};

const getDirectionSortKey = (direction: string) => {
  if (direction === 'LONG') {
    return 0;
  }
  if (direction === 'SHORT') {
    return 1;
  }
  return 2;
};

const getMonthKey = (timestamp: number | null | undefined) => {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return 'UNKNOWN';
  }
  return new Date(timestamp).toISOString().slice(0, 7);
};

const isDirectionMatchAtThreshold = (
  evaluation: AiTrainEvaluation,
  threshold: number,
) => {
  const directionMatches =
    typeof evaluation.modelDirectionMatches === 'boolean'
      ? evaluation.modelDirectionMatches
      : evaluation.aiApproved;
  return (
    directionMatches === true &&
    evaluation.quality != null &&
    evaluation.quality >= threshold
  );
};

export const summarizeAiTrainEvaluationsByDirection = (
  evaluations: AiTrainEvaluation[],
): AiTrainDirectionSummary[] => {
  const grouped = new Map<string, AiTrainEvaluation[]>([
    ['LONG', []],
    ['SHORT', []],
  ]);

  for (const evaluation of evaluations) {
    const direction =
      typeof evaluation.direction === 'string' && evaluation.direction.trim()
        ? evaluation.direction
        : 'UNKNOWN';
    const bucket = grouped.get(direction) ?? [];
    bucket.push(evaluation);
    grouped.set(direction, bucket);
  }

  return [...grouped.entries()]
    .sort(
      ([leftDirection], [rightDirection]) =>
        getDirectionSortKey(leftDirection) -
          getDirectionSortKey(rightDirection) ||
        leftDirection.localeCompare(rightDirection),
    )
    .map(([direction, directionEvaluations]) => ({
      direction,
      summary: summarizeAiTrainEvaluations(directionEvaluations),
    }));
};

export const summarizeAiTrainEvaluationsByMonth = (
  evaluations: AiTrainEvaluation[],
): AiTrainMonthlySummary[] => {
  const grouped = new Map<string, AiTrainEvaluation[]>();

  for (const evaluation of evaluations) {
    const month = getMonthKey(evaluation.timestamp);
    const bucket = grouped.get(month) ?? [];
    bucket.push(evaluation);
    grouped.set(month, bucket);
  }

  return [...grouped.entries()]
    .sort(([leftMonth], [rightMonth]) => leftMonth.localeCompare(rightMonth))
    .map(([month, monthEvaluations]) => ({
      month,
      summary: summarizeAiTrainEvaluations(monthEvaluations),
    }));
};

export const summarizeAiTrainEvaluationsByQualityThreshold = (
  evaluations: AiTrainEvaluation[],
  thresholds = [3, 4, 5],
): AiTrainQualityThresholdSummary[] =>
  thresholds.map((threshold) => ({
    threshold,
    label: `q${threshold}+`,
    summary: summarizeAiTrainEvaluations(
      evaluations.map((evaluation) => ({
        ...evaluation,
        aiApproved: isDirectionMatchAtThreshold(evaluation, threshold),
      })),
    ),
  }));
