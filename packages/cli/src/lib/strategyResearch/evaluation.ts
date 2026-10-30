import type { ResearchEntryPolicy } from '@tradejs/types';
import {
  buildTerminalWindows,
  summarizeCoreResearchWindow,
  orderCoreResearchTrades,
} from '../coreResearch/metrics';
import type { CoreResearchTrade } from '../coreResearch/types';
import type {
  ResearchDataset,
  ResearchEvaluation,
  StrategyResearchSpec,
} from './types';

export const researchTerminalWindows = (
  trades: CoreResearchTrade[],
  start: number,
  end: number,
) =>
  buildTerminalWindows({
    trades,
    end,
    terminalDays: [365, 180, 90, 30, 7],
  }).map((window) =>
    window.start < start
      ? summarizeCoreResearchWindow({
          trades,
          start,
          end,
          label: `${window.label} (покрытие ${((end - start) / 86_400_000).toFixed(1)} дн.)`,
        })
      : window,
  );

export const evaluateResearchComposition = (parameters: {
  spec: StrategyResearchSpec;
  dataset: ResearchDataset;
  id: string;
  coreId: string;
  role: 'baseline' | 'candidate';
  policy: ResearchEntryPolicy;
  development?: boolean;
}): ResearchEvaluation => {
  const { spec, dataset } = parameters;
  const start = spec.core.window.start;
  const end = parameters.development ? spec.testSince : spec.core.window.end;
  const testStart = parameters.development ? start : spec.testSince;
  const trades = dataset.trades.filter(
    (trade) =>
      trade.signalTimestamp >= start &&
      trade.signalTimestamp < end &&
      trade.exitTimestamp < end,
  );
  const test = trades.filter((trade) => trade.signalTimestamp >= testStart);
  const windows = [
    summarizeCoreResearchWindow({ trades, label: 'full', start, end }),
    summarizeCoreResearchWindow({
      trades: test,
      label: parameters.development ? 'DEV' : 'TEST',
      start: testStart,
      end,
    }),
    ...researchTerminalWindows(trades, start, end),
  ];
  const stressed = test.map((trade) => ({
    ...trade,
    netProfit:
      trade.netProfit -
      (Math.abs(trade.entryPrice * trade.qty) *
        spec.selection.extraRoundTripBps) /
        10_000,
  }));
  const stress = summarizeCoreResearchWindow({
    trades: stressed,
    label: 'TEST extra round-trip costs',
    start: testStart,
    end,
  });
  const testEvents = new Set(test.map((trade) => trade.signalTimestamp)).size;
  const counts = (key: (trade: CoreResearchTrade) => string) => {
    const result = new Map<string, number>();
    for (const trade of test)
      result.set(key(trade), (result.get(key(trade)) ?? 0) + 1);
    return test.length
      ? [...result.values()].reduce(
          (maximum, count) => Math.max(maximum, count),
          0,
        ) / test.length
      : 0;
  };
  const eventShare = counts((trade) => String(trade.signalTimestamp));
  const symbolShare = counts((trade) => trade.symbol);
  const active: CoreResearchTrade[] = [];
  const projected: CoreResearchTrade[] = [];
  let rejected = 0;
  let peakPositions = 0;
  for (const trade of [...trades].sort(
    (a, b) =>
      a.entryTimestamp - b.entryTimestamp ||
      a.symbol.localeCompare(b.symbol) ||
      a.signalId.localeCompare(b.signalId),
  )) {
    for (let index = active.length - 1; index >= 0; index--)
      if (active[index].exitTimestamp < trade.entryTimestamp)
        active.splice(index, 1);
    if (
      active.length >= spec.portfolio.maxConcurrentPositions ||
      (active.length + 1) * spec.core.execution.maxLossValue >
        spec.portfolio.maxOpenRisk
    ) {
      rejected++;
      continue;
    }
    active.push(trade);
    projected.push(trade);
    peakPositions = Math.max(peakPositions, active.length);
  }
  const metrics = windows[1].cohorts.ALL;
  const reasons: string[] = [];
  if (testEvents < spec.selection.minimumEvents)
    reasons.push(
      `Недостаточно независимых событий: ${testEvents}/${spec.selection.minimumEvents}`,
    );
  if (!(metrics.pnl > 0))
    reasons.push('Результат проверочной части после расходов не положителен');
  if (
    metrics.profitFactorStatus !== 'infinite_no_gross_loss' &&
    (metrics.profitFactor == null ||
      metrics.profitFactor < spec.selection.minimumProfitFactor)
  )
    reasons.push('PF ниже зафиксированного минимума');
  if (metrics.realizedMaxDrawdown > spec.selection.maximumDrawdown)
    reasons.push('Превышена допустимая просадка');
  if (metrics.maximumConsecutiveLosses > spec.selection.maximumLossStreak)
    reasons.push('Превышена допустимая серия убытков');
  if ((metrics.cadencePerDay ?? 0) < spec.selection.minimumCadencePerDay)
    reasons.push('Частота ниже зафиксированного минимума');
  if (
    eventShare > spec.selection.maximumEventShare ||
    symbolShare > spec.selection.maximumSymbolShare
  )
    reasons.push('Превышена концентрация событий или инструментов');
  if (!(stress.cohorts.ALL.pnl > 0))
    reasons.push('Преимущество исчезает при дополнительных расходах');
  if (rejected)
    reasons.push(
      'Лимит общего риска меняет сделки; требуется совместное исполнение стратегии с ограничителем портфеля',
    );
  let equity = 0;
  return {
    id: parameters.id,
    coreId: parameters.coreId,
    role: parameters.role,
    policy: parameters.policy,
    windows,
    testEvents,
    eventShare,
    symbolShare,
    stress,
    passed: !reasons.length,
    reasons,
    equity: orderCoreResearchTrades(trades).map((trade) => [
      trade.exitTimestamp,
      (equity += trade.netProfit),
    ]),
    capacity: {
      rejected,
      peakPositions,
      projected: summarizeCoreResearchWindow({
        trades: projected,
        label: 'Capacity projection, diagnostic only',
        start,
        end,
      }),
    },
    funnel: dataset.funnel,
  };
};

export const chooseDevelopmentPrimary = (
  evaluations: ResearchEvaluation[],
): string | null => {
  const baseline = evaluations.find(
    (evaluation) => evaluation.role === 'baseline',
  );
  const candidates = evaluations.filter(
    (evaluation) =>
      evaluation.role === 'candidate' &&
      evaluation.passed &&
      (evaluation.windows[1].cohorts.ALL.pnlPerTrade ?? -Infinity) >
        (baseline?.windows[1].cohorts.ALL.pnlPerTrade ?? 0),
  );
  candidates.sort(
    (a, b) =>
      b.windows[1].cohorts.ALL.pnlPerTrade! -
        a.windows[1].cohorts.ALL.pnlPerTrade! ||
      a.windows[1].cohorts.ALL.realizedMaxDrawdown -
        b.windows[1].cohorts.ALL.realizedMaxDrawdown ||
      a.id.localeCompare(b.id),
  );
  return candidates[0]?.id ?? null;
};

export const equivalentResearchExecutions = (
  left: ResearchDataset,
  right: ResearchDataset,
) => {
  const normalize = (dataset: ResearchDataset) =>
    dataset.trades
      .map((trade) => ({
        symbol: trade.symbol,
        direction: trade.direction,
        signalTimestamp: trade.signalTimestamp,
        entryTimestamp: trade.entryTimestamp,
        exitTimestamp: trade.exitTimestamp,
        entryPrice: trade.entryPrice,
        qty: trade.qty,
        netProfit: trade.netProfit,
      }))
      .sort(
        (a, b) =>
          a.signalTimestamp - b.signalTimestamp ||
          a.symbol.localeCompare(b.symbol) ||
          a.direction.localeCompare(b.direction),
      );
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
};
