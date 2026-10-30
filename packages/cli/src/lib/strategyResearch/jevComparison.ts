import { DAY_MS } from '../coreResearch/metrics';
import { sha256Json } from '../coreResearch/io';
import { calendarMeanInterval } from './events';
import type {
  FrozenJevResearchPair,
  ResearchComposition,
  ResearchDataset,
  ResearchEvaluation,
  ResearchJevComparison,
  StrategyResearchSpec,
} from './types';

/** Freeze one same-core pair and a common direction mask before opening TEST. */
export const freezeJevResearchPair = (
  compositions: ResearchComposition[],
  development: ResearchEvaluation[],
  primaryId: string | null,
): FrozenJevResearchPair | null => {
  const paired = compositions.filter((item) => item.jevPairId && item.jev);
  const anchor =
    paired.find((item) => item.id === primaryId) ??
    paired.find((item) => item.role === 'baseline') ??
    paired[0];
  if (!anchor) return null;
  const withJev =
    anchor.jev === 'enabled'
      ? anchor
      : paired.find(
          (item) =>
            item.jevPairId === anchor.jevPairId && item.jev === 'enabled',
        );
  const withoutJev =
    anchor.jev === 'disabled'
      ? anchor
      : paired.find(
          (item) =>
            item.jevPairId === anchor.jevPairId && item.jev === 'disabled',
        );
  if (!withJev || !withoutJev)
    throw new Error('Jev comparison requires both preregistered arms');
  const directions = anchor.policy.directions ?? ['LONG', 'SHORT'];
  // If DEV produced no eligible primary, retain the original scope for diagnosis.
  const common = directions.length
    ? directions
    : (['LONG', 'SHORT'] as Array<'LONG' | 'SHORT'>);
  const bind = (item: ResearchComposition): ResearchComposition => ({
    ...item,
    id:
      item.id === 'baseline' && common.length !== 2
        ? 'jev-compare-baseline'
        : item.id,
    role:
      item.id === 'baseline' && common.length !== 2 ? 'candidate' : item.role,
    policy: { ...item.policy, directions: [...common] },
  });
  const score = (id: string) =>
    development.find((item) => item.id === id)?.windows[1].cohorts.ALL
      .pnlPerTrade ?? -Infinity;
  return {
    pairId: anchor.jevPairId!,
    coreId: anchor.coreId,
    withJev: bind(withJev),
    withoutJev: bind(withoutJev),
    preferredOnDev:
      anchor.id === primaryId
        ? anchor.jev!
        : score(withoutJev.id) > score(withJev.id)
          ? 'disabled'
          : 'enabled',
    method:
      anchor.policy.mode === 'rules'
        ? 'independently-fitted-filters'
        : 'current-gate-toggle',
  };
};

export const compareJevResearch = (
  spec: StrategyResearchSpec,
  pair: FrozenJevResearchPair | null | undefined,
  evaluations: ResearchEvaluation[],
  datasets: Map<string, ResearchDataset>,
  development: ResearchEvaluation[],
  compositions: ResearchComposition[],
  exposed: boolean,
): ResearchJevComparison => {
  const dev = [
    ...new Set(
      compositions.flatMap((item) => (item.jevPairId ? [item.jevPairId] : [])),
    ),
  ].map((pairId) => {
    const metrics = (mode: 'enabled' | 'disabled') => {
      const ids = compositions
        .filter((item) => item.jevPairId === pairId && item.jev === mode)
        .map((item) => item.id);
      return (
        development.find((item) => ids.includes(item.id))?.windows[1] ?? null
      );
    };
    return {
      pairId,
      withJev: metrics('enabled'),
      withoutJev: metrics('disabled'),
    };
  });
  const evidence = exposed ? ('retrospective' as const) : ('unopened' as const);
  if (!pair)
    return {
      status: 'not-configured',
      reason: 'Jev не настроен: модель и оценки автоматически не создавались',
      evidence,
      dev,
    };
  if (
    pair.withJev.coreId !== pair.withoutJev.coreId ||
    pair.withJev.policy.mode !== pair.withoutJev.policy.mode ||
    sha256Json(pair.withJev.policy.directions) !==
      sha256Json(pair.withoutJev.policy.directions)
  )
    throw new Error(
      'Jev pair must use the same core, gate family and frozen directions',
    );
  const withJev = evaluations.find((item) => item.id === pair.withJev.id),
    withoutJev = evaluations.find((item) => item.id === pair.withoutJev.id);
  if (!withJev || !withoutJev)
    throw new Error('Frozen Jev arms were not both executed');
  const withData = datasets.get(pair.withJev.id),
    withoutData = datasets.get(pair.withoutJev.id);
  if (!withData || !withoutData)
    throw new Error('Missing native Jev execution dataset');
  const neutral = (data: ResearchDataset) =>
    Object.fromEntries(
      Object.entries(data.variant.resolvedConfig).filter(
        ([key]) => !['JEV', 'RESEARCH_ENTRY_POLICY'].includes(key),
      ),
    );
  if (
    !withData.variant.resolvedConfig.JEV ||
    withoutData.variant.resolvedConfig.JEV ||
    sha256Json(neutral(withData)) !== sha256Json(neutral(withoutData))
  )
    throw new Error('Jev arms differ in non-Jev runtime configuration');
  const window = (item: ResearchEvaluation) =>
    item.windows.find((row) => row.label === 'TEST')!;
  const withWindow = window(withJev),
    withoutWindow = window(withoutJev);
  const days = Math.ceil((spec.core.window.end - spec.testSince) / DAY_MS);
  const deltas = Array.from({ length: days }, (_, day) => ({
    timestamp: spec.testSince + day * DAY_MS,
    value: 0,
  }));
  for (const [id, sign] of [
    [pair.withJev.id, 1],
    [pair.withoutJev.id, -1],
  ] as const) {
    const data = datasets.get(id);
    if (!data) throw new Error('Missing native Jev execution dataset');
    for (const trade of data.trades) {
      if (
        trade.signalTimestamp < spec.testSince ||
        trade.exitTimestamp >= spec.core.window.end
      )
        continue;
      const day = Math.floor((trade.exitTimestamp - spec.testSince) / DAY_MS);
      if (deltas[day]) deltas[day].value += sign * trade.netProfit;
    }
  }
  const interval = calendarMeanInterval(
    deltas,
    spec.testSince,
    spec.core.window.end,
    `${spec.core.researchId}-jev-delta`,
  );
  const pnlDelta = withWindow.cohorts.ALL.pnl - withoutWindow.cohorts.ALL.pnl;
  const testRows = withData.rows.filter(
    (row) =>
      Number(row.timestamp) >= spec.testSince &&
      Number(row.timestamp) < spec.core.window.end &&
      Number(row.exitTimestamp) < spec.core.window.end,
  );
  const scored = testRows.filter((row) =>
    Object.entries(row.features).some(
      ([key, value]) =>
        key.startsWith('additionalIndicators.jev.scores.') &&
        typeof value === 'number' &&
        Number.isFinite(value),
    ),
  );
  const jevCoverage = {
    testRows: testRows.length,
    scoredRows: scored.length,
    scoredEvents: new Set(scored.map((row) => row.timestamp)).size,
  };
  const supported =
    jevCoverage.scoredEvents >= spec.selection.minimumEvents &&
    withJev.testEvents >= spec.selection.minimumEvents &&
    withoutJev.testEvents >= spec.selection.minimumEvents &&
    !withJev.capacity.rejected &&
    !withoutJev.capacity.rejected;
  const status =
    !supported || !interval
      ? 'inconclusive'
      : withJev.passed && pnlDelta > 0 && interval[0] > 0
        ? 'improved'
        : pnlDelta < 0 && interval[1] < 0
          ? 'worse'
          : 'inconclusive';
  return {
    status,
    evidence,
    pair,
    dev,
    pnlDelta,
    drawdownDelta:
      withWindow.cohorts.ALL.realizedMaxDrawdown -
      withoutWindow.cohorts.ALL.realizedMaxDrawdown,
    jevCoverage,
    dailyPnlDeltaInterval95: interval,
    withJev: withWindow,
    withoutJev: withoutWindow,
    reason: !supported
      ? 'Недостаточно событий или оценок Jev, либо ограничитель риска меняет сделки'
      : status === 'improved'
        ? 'В этой паре TEST результат с Jev выше; интервал средней дневной разницы положителен'
        : status === 'worse'
          ? 'В этой паре TEST результат с Jev ниже; интервал средней дневной разницы отрицателен'
          : 'Убедительное преимущество Jev на этом периоде не установлено',
  };
};
