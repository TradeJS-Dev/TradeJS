import type { AiPocketSearchResult, AiPocketSearchRow } from './contracts';
import { buildPredicateListMask } from './predicates';
import { summarizeAiPocketRows } from './summary';

/** In-sample temporal stability; it never reads the outer test. */
export const assessDevelopmentStability = (
  result: AiPocketSearchResult,
  options: {
    developmentRows: AiPocketSearchRow[];
    baselineRows: AiPocketSearchRow[];
    timestamps: number[];
    minEventsPerFold?: number;
  },
) => {
  const minEvents = options.minEventsPerFold ?? 5;
  const timestamps = [...new Set(options.timestamps)].sort((a, b) => a - b);
  const boundaries = [0, 1, 2, 3].map((index) =>
    index === 3
      ? timestamps.at(-1) == null
        ? Number.POSITIVE_INFINITY
        : timestamps.at(-1)! + 1
      : timestamps[Math.floor((timestamps.length * index) / 3)] ??
        Number.POSITIVE_INFINITY,
  );
  const blocks = [0, 1, 2].map((index) => ({
    start: boundaries[index],
    end: boundaries[index + 1],
    rows: options.developmentRows.filter(
      (row) =>
        row.timestamp != null &&
        row.timestamp >= boundaries[index] &&
        row.timestamp < boundaries[index + 1],
    ),
    baseline: options.baselineRows.filter(
      (row) =>
        row.timestamp != null &&
        row.timestamp >= boundaries[index] &&
        row.timestamp < boundaries[index + 1],
    ),
  }));
  for (const pocket of result.positivePockets) {
    const folds = blocks.map((block) => {
      const mask = buildPredicateListMask(block.rows, pocket.predicates).mask;
      const selected = block.rows.filter((_, index) => mask[index] === 1);
      const summary = summarizeAiPocketRows(selected);
      const baseline = summarizeAiPocketRows(block.baseline);
      const objectiveSummary =
        result.objective === 'add-to-gate'
          ? summarizeAiPocketRows([
              ...new Set([...block.baseline, ...selected]),
            ])
          : summary;
      return {
        startTimestamp: Number.isFinite(block.start) ? block.start : null,
        endTimestamp: Number.isFinite(block.end) ? block.end : null,
        summary,
        objectiveSummary,
        baseline,
      };
    });
    const supported = folds.filter((fold) => fold.summary.events >= minEvents);
    const unstable = supported.some(
      (fold) =>
        fold.objectiveSummary.totalProfit <
          (result.objective === 'add-to-gate'
            ? fold.baseline.totalProfit
            : 0) ||
        (fold.objectiveSummary.profitFactor ??
          (fold.objectiveSummary.grossLoss === 0 ? Infinity : 0)) < 1,
    );
    const status = unstable
      ? 'unstable'
      : supported.length < 3
        ? 'insufficient-support'
        : 'stable';
    pocket.stability = {
      status,
      role: 'development-only diagnostic',
      minEventsPerFold: minEvents,
      folds,
    };
    if (status !== 'stable') {
      pocket.readiness = 'research-only';
      pocket.readinessReasons.push(`development stability: ${status}`);
    }
  }
  // Prefer temporal stability within the bounded shortlist; outer economics are absent.
  const rank = { stable: 0, 'insufficient-support': 1, unstable: 2 };
  result.positivePockets.sort(
    (a, b) => rank[a.stability!.status] - rank[b.stability!.status],
  );
};
