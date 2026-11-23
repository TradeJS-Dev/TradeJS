import type {
  PortfolioEntryBatch,
  PortfolioEntryCandidate,
  PortfolioEntrySelection,
} from '@tradejs/types';

export function validatePortfolioSelection(
  batch: PortfolioEntryBatch,
  selection: PortfolioEntrySelection,
  step: number,
): void {
  const seen = new Set<string>();
  const available = new Map(batch.candidates.map((item) => [item.id, item]));
  const take = (id: string): PortfolioEntryCandidate => {
    const candidate = available.get(id);
    if (!candidate || seen.has(id)) {
      throw new Error(`Unknown or repeated portfolio candidate: ${id}`);
    }
    seen.add(id);
    return candidate;
  };
  for (const id of selection.ranked) {
    if (!take(id).gate.approved)
      throw new Error(`Rejected immediate entry: ${id}`);
  }
  for (const { candidateId, confirmAt } of selection.pending) {
    const { gate } = take(candidateId);
    if (
      gate.approved ||
      gate.explicitHardBlock ||
      !gate.reason?.startsWith('AI_QUALITY_BELOW_MIN (') ||
      confirmAt !== batch.closedAt + step
    ) {
      throw new Error(`Invalid delayed portfolio entry: ${candidateId}`);
    }
  }
}
