type JsonRecord = Record<string, unknown>;

export type RuntimeScorecardThresholds = {
  minimumParityRatio: number;
  maximumSlippageResidualBps: number;
  minimumClosedTrades: number;
  minimumExpectancy: number;
};

export type RuntimeScorecard = ReturnType<typeof buildRuntimeScorecard>;

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const finiteString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const round = (value: number, decimals = 6) => Number(value.toFixed(decimals));

const unwrapRows = (value: unknown, key: string) =>
  asArray(value)
    .map((item) => asRecord(asRecord(item)?.[key]) ?? asRecord(item))
    .filter((item): item is JsonRecord => item != null);

const runtimePayload = (artifact: unknown) => {
  const root = asRecord(artifact) ?? {};
  return asRecord(root.runtime) ?? root;
};

const runtimeWindow = (artifact: unknown) => {
  const root = asRecord(artifact) ?? {};
  return (
    asRecord(root.window) ?? asRecord(runtimePayload(artifact).window) ?? {}
  );
};

const extractRuntimeRows = (artifact: unknown) => {
  const runtime = runtimePayload(artifact);
  return {
    evaluations: unwrapRows(runtime.evaluations, 'evaluation'),
    signals: unwrapRows(runtime.signals, 'signal'),
    trades: unwrapRows(runtime.trades, 'trade'),
    statsBuckets: asArray(runtime.evaluationStatsBuckets)
      .map(asRecord)
      .filter((item): item is JsonRecord => item != null),
  };
};

const countBy = (
  items: JsonRecord[],
  getter: (item: JsonRecord) => string | null,
) => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
};

const buildDistributions = ({
  evaluations,
  signals,
}: {
  evaluations: JsonRecord[];
  signals: JsonRecord[];
}) => {
  const candidates = evaluations.filter(
    (evaluation) => evaluation.status === 'signal',
  );
  return {
    candidatesByStrategy: countBy(candidates, (evaluation) =>
      finiteString(evaluation.strategy),
    ),
    orderStatus: countBy(signals, (signal) => finiteString(signal.orderStatus)),
    skipReasons: countBy(signals, (signal) =>
      finiteString(signal.orderSkipReason),
    ),
    aiQuality: countBy(candidates, (evaluation) => {
      const quality = finiteNumber(asRecord(evaluation.aiAnalysis)?.quality);
      return quality == null ? null : String(quality);
    }),
  };
};

const buildDistributionDelta = (
  current: Record<string, number>,
  previous: Record<string, number>,
) => {
  const currentTotal = Object.values(current).reduce(
    (total, value) => total + value,
    0,
  );
  const previousTotal = Object.values(previous).reduce(
    (total, value) => total + value,
    0,
  );
  const keys = [
    ...new Set([...Object.keys(current), ...Object.keys(previous)]),
  ].sort((left, right) => left.localeCompare(right));

  return Object.fromEntries(
    keys.map((key) => {
      const currentCount = current[key] ?? 0;
      const previousCount = previous[key] ?? 0;
      const currentShare = currentTotal > 0 ? currentCount / currentTotal : 0;
      const previousShare =
        previousTotal > 0 ? previousCount / previousTotal : 0;
      return [
        key,
        {
          currentCount,
          previousCount,
          currentShare: round(currentShare),
          previousShare: round(previousShare),
          shareDelta: round(currentShare - previousShare),
        },
      ];
    }),
  );
};

const sum = (values: Array<number | null>) =>
  round(values.reduce<number>((total, value) => total + (value ?? 0), 0));

const statsCount = (buckets: JsonRecord[], field: string) =>
  sum(buckets.map((bucket) => finiteNumber(asRecord(bucket.stats)?.[field])));

const tradeTimestamp = (trade: JsonRecord) =>
  finiteNumber(trade.exitTimestamp) ??
  finiteNumber(trade.lastSyncedAt) ??
  finiteNumber(trade.entryTimestamp) ??
  0;

const dedupeTrades = (artifacts: unknown[]) => {
  const tradesByOrderId = new Map<string, JsonRecord>();
  for (const artifact of artifacts) {
    for (const trade of extractRuntimeRows(artifact).trades) {
      const orderId = finiteString(trade.orderId);
      if (!orderId) continue;
      const existing = tradesByOrderId.get(orderId);
      if (!existing || tradeTimestamp(trade) >= tradeTimestamp(existing)) {
        tradesByOrderId.set(orderId, trade);
      }
    }
  }
  return [...tradesByOrderId.values()];
};

const maxDrawdown = (trades: JsonRecord[]) => {
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const trade of trades.sort(
    (left, right) => tradeTimestamp(left) - tradeTimestamp(right),
  )) {
    cumulative += finiteNumber(trade.closedPnl) ?? 0;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return round(drawdown);
};

const buildRollingPerformance = ({
  trades,
  anchorTime,
  days,
}: {
  trades: JsonRecord[];
  anchorTime: number;
  days: number;
}) => {
  const startTime = anchorTime - days * 24 * 60 * 60 * 1000;
  const closed = trades.filter((trade) => {
    const exitTimestamp = finiteNumber(trade.exitTimestamp);
    return (
      trade.status === 'closed' &&
      exitTimestamp != null &&
      exitTimestamp >= startTime &&
      exitTimestamp < anchorTime
    );
  });
  const realizedPnl = sum(closed.map((trade) => finiteNumber(trade.closedPnl)));
  return {
    days,
    closedTrades: closed.length,
    realizedPnl,
    expectancy: closed.length > 0 ? round(realizedPnl / closed.length) : null,
    maxDrawdown: maxDrawdown(closed),
  };
};

const getReplayComparison = (artifact: unknown) => {
  const root = asRecord(artifact) ?? {};
  return asRecord(asRecord(root.replay)?.runtimeComparison) ?? null;
};

const getCalibrationSummary = (artifact: unknown) => {
  const root = asRecord(artifact) ?? {};
  return asRecord(asRecord(root.summary)?.all) ?? null;
};

export const buildRuntimeScorecard = ({
  runtimeArtifact,
  replayEvidenceArtifact,
  calibrationArtifact,
  historyRuntimeArtifacts = [],
  thresholds = {
    minimumParityRatio: 0.95,
    maximumSlippageResidualBps: 3,
    minimumClosedTrades: 20,
    minimumExpectancy: 0,
  },
  generatedAt = Date.now(),
}: {
  runtimeArtifact: unknown;
  replayEvidenceArtifact?: unknown;
  calibrationArtifact?: unknown;
  historyRuntimeArtifacts?: unknown[];
  thresholds?: RuntimeScorecardThresholds;
  generatedAt?: number;
}) => {
  const rows = extractRuntimeRows(runtimeArtifact);
  const window = runtimeWindow(runtimeArtifact);
  const startTime = finiteNumber(window.startTime) ?? generatedAt - 86_400_000;
  const endTime = finiteNumber(window.endTime) ?? generatedAt;
  const evaluationsFromStats = statsCount(rows.statsBuckets, 'evaluated');
  const candidatesFromStats = statsCount(rows.statsBuckets, 'signals');
  const signalEvaluations = rows.evaluations.filter(
    (evaluation) => evaluation.status === 'signal',
  );
  const gateDecisions = signalEvaluations
    .map((evaluation) => ({
      evaluation,
      decision: finiteString(asRecord(evaluation.aiAnalysis)?.gateDecision),
    }))
    .filter(
      ({ decision }) => decision === 'approved' || decision === 'rejected',
    );
  const allocatorDecisions = signalEvaluations
    .map((evaluation) => asRecord(evaluation.allocatorDecision))
    .filter((item): item is JsonRecord => item != null);
  const riskDecisions = signalEvaluations
    .map((evaluation) => asRecord(evaluation.riskDecision))
    .filter((item): item is JsonRecord => item != null);
  const orderAttempts = rows.signals.filter(
    (signal) =>
      signal.orderStatus === 'completed' || signal.orderStatus === 'failed',
  );
  const currentClosedTrades = rows.trades.filter((trade) => {
    const exitTimestamp = finiteNumber(trade.exitTimestamp);
    return (
      trade.status === 'closed' &&
      exitTimestamp != null &&
      exitTimestamp >= startTime &&
      exitTimestamp < endTime
    );
  });
  const replayComparison = getReplayComparison(replayEvidenceArtifact);
  const replayCounts = asRecord(replayComparison?.counts);
  const matched = finiteNumber(replayCounts?.matched) ?? 0;
  const backtestOnly = finiteNumber(replayCounts?.backtestOnly) ?? 0;
  const runtimeOnly = finiteNumber(replayCounts?.runtimeOnly) ?? 0;
  const comparisonTotal = matched + backtestOnly + runtimeOnly;
  const parityRatio = comparisonTotal > 0 ? matched / comparisonTotal : null;
  const lineage = asRecord(replayComparison?.lineage);
  const lineageReason = finiteString(lineage?.reason);
  const calibration = getCalibrationSummary(calibrationArtifact);
  const actualSlippageBps = finiteNumber(
    asRecord(calibration?.signalToFillAdverseBps)?.avg,
  );
  const residualVsModelBps = finiteNumber(
    asRecord(calibration?.residualVsCurrentModelBps)?.avg,
  );
  const historyTrades = dedupeTrades([
    ...historyRuntimeArtifacts,
    runtimeArtifact,
  ]);
  const currentDistributions = buildDistributions(rows);
  const previousArtifact = historyRuntimeArtifacts
    .map((artifact) => ({ artifact, window: runtimeWindow(artifact) }))
    .filter(({ window: candidateWindow }) => {
      const candidateEndTime = finiteNumber(candidateWindow.endTime);
      return candidateEndTime != null && candidateEndTime <= startTime;
    })
    .sort(
      (left, right) =>
        (finiteNumber(right.window.endTime) ?? 0) -
        (finiteNumber(left.window.endTime) ?? 0),
    )[0];
  const previousDistributions = previousArtifact
    ? buildDistributions(extractRuntimeRows(previousArtifact.artifact))
    : null;
  const rolling = [7, 30, 90].map((days) =>
    buildRollingPerformance({
      trades: [...historyTrades],
      anchorTime: endTime,
      days,
    }),
  );
  const sevenDay = rolling[0];
  const reactions: Array<{
    code: string;
    severity: 'info' | 'warning' | 'blocking';
    message: string;
  }> = [];

  if (lineageReason) {
    reactions.push({
      code: 'LINEAGE_NOT_COMPARABLE',
      severity: 'blocking',
      message: lineageReason,
    });
  }
  if (parityRatio != null && parityRatio < thresholds.minimumParityRatio) {
    reactions.push({
      code: 'PARITY_REGRESSION',
      severity: 'blocking',
      message: `Parity ${round(parityRatio * 100, 2)}% is below ${round(thresholds.minimumParityRatio * 100, 2)}%.`,
    });
  }
  if (
    residualVsModelBps != null &&
    residualVsModelBps > thresholds.maximumSlippageResidualBps
  ) {
    reactions.push({
      code: 'SLIPPAGE_DRIFT',
      severity: 'warning',
      message: `Execution residual ${round(residualVsModelBps, 2)} bps exceeds ${thresholds.maximumSlippageResidualBps} bps.`,
    });
  }
  if (
    sevenDay.closedTrades >= thresholds.minimumClosedTrades &&
    sevenDay.expectancy != null &&
    sevenDay.expectancy < thresholds.minimumExpectancy
  ) {
    reactions.push({
      code: 'EXPECTANCY_DEGRADATION',
      severity: 'blocking',
      message: `7d expectancy ${sevenDay.expectancy} is below ${thresholds.minimumExpectancy}.`,
    });
  }
  if (sevenDay.closedTrades < thresholds.minimumClosedTrades) {
    reactions.push({
      code: 'INSUFFICIENT_RECENT_SAMPLE',
      severity: 'info',
      message: `Only ${sevenDay.closedTrades} closed trades in 7d; ${thresholds.minimumClosedTrades} required for expectancy reaction.`,
    });
  }

  const promotionStatus = reactions.some(
    (reaction) => reaction.severity === 'blocking',
  )
    ? 'PROMOTION_BLOCKED'
    : reactions.some((reaction) => reaction.severity === 'warning')
      ? 'REVIEW_REQUIRED'
      : 'OBSERVE';

  return {
    reportType: 'runtime-scorecard' as const,
    schemaVersion: 1,
    generatedAt,
    window: { startTime, endTime },
    promotionStatus,
    thresholds,
    funnel: {
      evaluations:
        evaluationsFromStats > 0
          ? evaluationsFromStats
          : rows.evaluations.length,
      coreCandidates:
        candidatesFromStats > 0
          ? candidatesFromStats
          : signalEvaluations.length,
      gate: {
        available: gateDecisions.length > 0,
        approved: gateDecisions.filter(
          ({ decision }) => decision === 'approved',
        ).length,
        rejected: gateDecisions.filter(
          ({ decision }) => decision === 'rejected',
        ).length,
        coverage: signalEvaluations.length
          ? round(gateDecisions.length / signalEvaluations.length)
          : null,
      },
      allocator: {
        available: allocatorDecisions.length > 0,
        approved: allocatorDecisions.filter(
          (decision) => decision.decision === 'approved',
        ).length,
        rejected: allocatorDecisions.filter(
          (decision) => decision.decision === 'rejected',
        ).length,
      },
      risk: {
        available: riskDecisions.length > 0,
        approved: riskDecisions.filter(
          (decision) => decision.decision === 'approved',
        ).length,
        rejected: riskDecisions.filter(
          (decision) => decision.decision === 'rejected',
        ).length,
      },
      orderAttempts: orderAttempts.length,
      orderFailures: orderAttempts.filter(
        (signal) => signal.orderStatus === 'failed',
      ).length,
      balanceRejects: rows.signals.filter((signal) =>
        /BALANCE|MARGIN/i.test(
          `${finiteString(signal.orderSkipReason) ?? ''} ${finiteString(signal.orderFailureReason) ?? ''}`,
        ),
      ).length,
      fills: rows.trades.length,
      closedTrades: currentClosedTrades.length,
    },
    realized: {
      pnl: sum(
        currentClosedTrades.map((trade) => finiteNumber(trade.closedPnl)),
      ),
      fees: sum(
        currentClosedTrades.map((trade) => finiteNumber(trade.totalFee)),
      ),
      funding: sum(
        currentClosedTrades.map((trade) => finiteNumber(trade.fundingFee)),
      ),
    },
    parity: {
      available: comparisonTotal > 0,
      matched,
      backtestOnly,
      runtimeOnly,
      ratio: parityRatio == null ? null : round(parityRatio),
      lineageReason,
    },
    execution: {
      available: calibration != null,
      actualSignalToFillSlippageBps: actualSlippageBps,
      residualVsCurrentModelBps: residualVsModelBps,
    },
    rolling,
    distributions: currentDistributions,
    distributionChanges: {
      available: previousDistributions != null,
      baselineWindow: previousArtifact
        ? {
            startTime: finiteNumber(previousArtifact.window.startTime),
            endTime: finiteNumber(previousArtifact.window.endTime),
          }
        : null,
      metrics: previousDistributions
        ? Object.fromEntries(
            Object.entries(currentDistributions).map(([name, current]) => [
              name,
              buildDistributionDelta(
                current,
                previousDistributions[
                  name as keyof typeof previousDistributions
                ],
              ),
            ]),
          )
        : {},
    },
    reactions,
  };
};

export const formatRuntimeScorecardMarkdown = (scorecard: RuntimeScorecard) => {
  const rollingRows = scorecard.rolling
    .map(
      (row) =>
        `| ${row.days}d | ${row.closedTrades} | ${row.realizedPnl} | ${row.expectancy ?? 'n/a'} | ${row.maxDrawdown} |`,
    )
    .join('\n');
  const reactions = scorecard.reactions.length
    ? scorecard.reactions
        .map(
          (reaction) =>
            `- ${reaction.severity.toUpperCase()} \`${reaction.code}\`: ${reaction.message}`,
        )
        .join('\n')
    : '- No automatic reactions.';
  const distributionChanges = Object.entries(
    scorecard.distributionChanges.metrics,
  )
    .flatMap(([metric, values]) =>
      Object.entries(values).map(([value, change]) => ({
        metric,
        value,
        shareDelta: change.shareDelta,
      })),
    )
    .sort(
      (left, right) => Math.abs(right.shareDelta) - Math.abs(left.shareDelta),
    )
    .slice(0, 10)
    .map(
      (change) =>
        `- ${change.metric}.${change.value}: ${change.shareDelta >= 0 ? '+' : ''}${round(change.shareDelta * 100, 2)} pp`,
    )
    .join('\n');

  return `# Runtime scorecard\n\nStatus: **${scorecard.promotionStatus}**\n\nWindow: ${new Date(scorecard.window.startTime).toISOString()} — ${new Date(scorecard.window.endTime).toISOString()}\n\n## Funnel\n\n- Evaluations: ${scorecard.funnel.evaluations}\n- Core candidates: ${scorecard.funnel.coreCandidates}\n- Gate approvals/rejects: ${scorecard.funnel.gate.approved}/${scorecard.funnel.gate.rejected}\n- Allocator approvals/rejects: ${scorecard.funnel.allocator.available ? `${scorecard.funnel.allocator.approved}/${scorecard.funnel.allocator.rejected}` : 'unavailable'}\n- Risk approvals/rejects: ${scorecard.funnel.risk.available ? `${scorecard.funnel.risk.approved}/${scorecard.funnel.risk.rejected}` : 'unavailable'}\n- Order attempts/failures: ${scorecard.funnel.orderAttempts}/${scorecard.funnel.orderFailures}\n- Fills: ${scorecard.funnel.fills}\n- Closed trades: ${scorecard.funnel.closedTrades}\n\n## Replay and execution\n\n- Parity: ${scorecard.parity.ratio == null ? 'n/a' : `${round(scorecard.parity.ratio * 100, 2)}%`}\n- Runtime/replay mismatches: ${scorecard.parity.backtestOnly + scorecard.parity.runtimeOnly}\n- Actual signal-to-fill slippage: ${scorecard.execution.actualSignalToFillSlippageBps ?? 'n/a'} bps\n- Residual vs current model: ${scorecard.execution.residualVsCurrentModelBps ?? 'n/a'} bps\n\n## Rolling performance\n\n| Window | Closed | Realized PnL | Expectancy | Max drawdown |\n| --- | ---: | ---: | ---: | ---: |\n${rollingRows}\n\n## Distribution changes\n\n${scorecard.distributionChanges.available ? distributionChanges || '- No distribution changes.' : '- Previous comparable artifact is unavailable.'}\n\n## Reactions\n\n${reactions}\n`;
};
