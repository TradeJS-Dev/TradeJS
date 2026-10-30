import type {
  ResearchEntryPolicy,
  ResearchEntryPredicate,
} from '@tradejs/types';
import {
  searchAiPockets,
  summarizeAiPocketRows,
  type AiPocketSearchRow,
  type AiPocketResult,
  type AiPocketSearchResult,
} from '../aiPocketSearch';
import { assessDevelopmentStability } from '../aiPocketSearch/stability';
import type {
  FrozenResearchGate,
  ResearchDataset,
  StrategyResearchSpec,
} from './types';

const roundStrict = (value: number, op: '<=' | '>=') => {
  if (value === 0) return 0;
  const step = 10 ** (Math.floor(Math.log10(Math.abs(value))) - 1);
  return Number(
    (
      (op === '>=' ? Math.ceil(value / step) : Math.floor(value / step)) * step
    ).toPrecision(12),
  );
};

const freezePredicates = (pocket: AiPocketResult): ResearchEntryPredicate[] =>
  pocket.predicates.map((predicate) =>
    predicate.kind === 'numeric'
      ? {
          path: predicate.featureKey,
          op: predicate.op,
          value: roundStrict(predicate.threshold, predicate.op),
        }
      : {
          path: predicate.featureKey,
          op: '==',
          value: predicate.value as string | boolean,
        },
  );

const matches = (row: AiPocketSearchRow, rules: ResearchEntryPredicate[]) =>
  rules.every((rule) => {
    const value = row.features[rule.path];
    if (value == null) return false;
    return rule.op === '=='
      ? value === rule.value
      : typeof value === 'number' &&
          (rule.op === '>=' ? value >= rule.value : value <= rule.value);
  });

export const discoverResearchGate = (
  spec: StrategyResearchSpec,
  dataset: ResearchDataset,
): FrozenResearchGate => {
  const discovery = {} as Record<'LONG' | 'SHORT', AiPocketSearchResult>;
  const rules: ResearchEntryPolicy['rules'] = { LONG: null, SHORT: null };
  for (const side of ['LONG', 'SHORT'] as const) {
    // loadDataset has already removed immature labels. Never send a test row to search.
    const rows = dataset.rows.filter(
      (row) =>
        row.direction === side &&
        row.modelCandidate !== false &&
        Number(row.timestamp) < spec.testSince &&
        Number(row.exitTimestamp) < spec.testSince,
    );
    const search = searchAiPockets(rows, {
      maxDepth: 2,
      maxAtomicPredicates: 180,
      maxCombinations: Math.max(
        1,
        Math.floor(
          spec.budget.maxCombinations / (2 * spec.core.variants.length),
        ),
      ),
      minSupport: spec.selection.minimumEvents,
      minEvents: spec.selection.minimumEvents,
      minProfitFactor: spec.selection.minimumProfitFactor,
      minTotalProfit: 0,
      top: 5,
      maxEventCountShare: spec.selection.maximumEventShare,
      maxSymbolCountShare: spec.selection.maximumSymbolShare,
      objective: 'standalone',
      validationRows: [],
      testRows: [],
      dedupeEquivalentSelections: true,
    });
    assessDevelopmentStability(search, {
      developmentRows: rows,
      baselineRows: rows.filter((row) => row.aiApproved),
      timestamps: [...new Set(rows.map((row) => Number(row.timestamp)))].sort(
        (a, b) => a - b,
      ),
    });
    discovery[side] = search;
    // Rank only on DEV. Rounding is another recorded DEV candidate; test results
    // cannot change the winner or restore the optimizer's precise cutoff.
    for (const pocket of search.positivePockets) {
      const rounded = freezePredicates(pocket);
      const roundedPocket = {
        ...pocket,
        readinessReasons: [...pocket.readinessReasons],
        predicates: pocket.predicates.map((predicate, index) =>
          predicate.kind === 'numeric'
            ? { ...predicate, threshold: rounded[index].value as number }
            : predicate,
        ),
      };
      assessDevelopmentStability(
        { ...search, positivePockets: [roundedPocket] },
        {
          developmentRows: rows,
          baselineRows: rows.filter((row) => row.aiApproved),
          timestamps: rows.map((row) => Number(row.timestamp)),
        },
      );
      const selected = rows.filter((row) => matches(row, rounded));
      const events = new Set(selected.map((row) => row.timestamp)).size;
      const summary = summarizeAiPocketRows(selected);
      if (
        roundedPocket.stability?.status === 'stable' &&
        events >= spec.selection.minimumEvents &&
        summary.totalProfit > 0 &&
        (summary.profitFactor ?? (summary.grossLoss === 0 ? Infinity : 0)) >=
          spec.selection.minimumProfitFactor &&
        (summary.topEventCountShare ?? 1) <= spec.selection.maximumEventShare &&
        (summary.topSymbolCountShare ?? 1) <= spec.selection.maximumSymbolShare
      ) {
        rules[side] = rounded;
        break;
      }
    }
  }
  return {
    coreId: dataset.variant.id,
    policy: {
      schema: 'tradejs-research-entry-policy/v1',
      strategy: spec.core.strategy,
      mode: 'rules',
      minQuality: spec.minQuality,
      rules,
    },
    discovery,
  };
};
