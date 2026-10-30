import type { ResearchEntryPolicy } from '@tradejs/types';
import { evaluateResearchComposition } from './evaluation';
import type {
  ResearchComposition,
  ResearchDataset,
  ResearchDirectionSelection,
  StrategyResearchSpec,
} from './types';

/** DEV trade subsets are screening evidence, never reconstructed native fills. */
export const selectResearchDirections = (
  spec: StrategyResearchSpec,
  dataset: ResearchDataset,
  composition: ResearchComposition,
) => {
  const trades = dataset.trades.filter(
    (trade) =>
      trade.signalTimestamp >= spec.core.window.start &&
      trade.signalTimestamp < spec.testSince &&
      trade.exitTimestamp < spec.testSince,
  );
  const evaluate = (directions: Array<'LONG' | 'SHORT'>) =>
    evaluateResearchComposition({
      spec,
      dataset: {
        ...dataset,
        trades: trades.filter((trade) => directions.includes(trade.direction)),
      },
      ...composition,
      development: true,
    });
  const bySide = { LONG: evaluate(['LONG']), SHORT: evaluate(['SHORT']) };
  const allowed = (side: 'LONG' | 'SHORT') =>
    (!composition.policy.directions ||
      composition.policy.directions.includes(side)) &&
    (composition.policy.mode !== 'rules' ||
      composition.policy.rules[side] !== null);
  const eligible = (['LONG', 'SHORT'] as const).filter(
    (side) => allowed(side) && bySide[side].passed,
  );
  let directions: Array<'LONG' | 'SHORT'> = [...eligible];
  let development = evaluate(directions);
  const jointReasons =
    directions.length === 2 && !development.passed ? development.reasons : [];
  // A joint risk/concentration failure may still leave a usable single side.
  if (directions.length === 2 && !development.passed) {
    directions = [
      [...directions].sort(
        (a, b) =>
          (bySide[b].windows[1].cohorts.ALL.pnlPerTrade ?? 0) -
            (bySide[a].windows[1].cohorts.ALL.pnlPerTrade ?? 0) ||
          a.localeCompare(b),
      )[0],
    ];
    development = bySide[directions[0]];
  }
  const changedControl =
    composition.role === 'baseline' && directions.length !== 2;
  const id = changedControl ? 'direction-baseline' : composition.id;
  const policy: ResearchEntryPolicy = { ...composition.policy, directions };
  const selected: ResearchComposition = {
    ...composition,
    id,
    policy,
    role: changedControl ? 'candidate' : composition.role,
  };
  const selection: ResearchDirectionSelection = {
    id,
    sourceId: composition.id,
    method: 'existing-dev-trades',
    window: { start: spec.core.window.start, end: spec.testSince },
    directions,
    sides: Object.fromEntries(
      (['LONG', 'SHORT'] as const).map((side) => [
        side,
        {
          eligible: allowed(side) && bySide[side].passed,
          events: bySide[side].testEvents,
          metrics: bySide[side].windows[1].cohorts.ALL,
          reasons: allowed(side)
            ? bySide[side].reasons
            : ['Направление отключено исходным правилом'],
        },
      ]),
    ) as ResearchDirectionSelection['sides'],
    reason: !directions.length
      ? 'На DEV нет направления с достаточным подтверждённым результатом'
      : `На DEV выбраны ${directions.join(' + ')}; нативное подтверждение выполняется после фиксации выбора${jointReasons.length ? `. Совместный режим отклонён: ${jointReasons.join('; ')}` : ''}`,
  };
  return {
    composition: selected,
    selection,
    development: { ...development, ...selected },
  };
};
