export type AiTrainEvaluation = {
  profit: number;
  profitableTrade: boolean;
  aiApproved: boolean;
  quality: number | null;
};

export type AiTrainQualityBucket = {
  quality: number | null;
  count: number;
  approved: number;
  profitable: number;
  totalProfit: number;
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
  expectancyDelta: number | null;
  qualityBuckets: AiTrainQualityBucket[];
};

const divideOrNull = (num: number, denom: number) => {
  if (denom <= 0) {
    return null;
  }
  return num / denom;
};

const qualitySortKey = (quality: number | null) =>
  quality == null ? Number.POSITIVE_INFINITY : quality;

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
    expectancyDelta,
    qualityBuckets: [...bucketMap.values()].sort(
      (a, b) => qualitySortKey(a.quality) - qualitySortKey(b.quality),
    ),
  };
};
