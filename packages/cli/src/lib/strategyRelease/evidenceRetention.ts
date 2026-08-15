import type { StrategyEvidenceRetentionEntry } from '@tradejs/types';

const DAY_MS = 86_400_000;

export const planStrategyEvidenceRetention = ({
  now,
  entries,
  retentionDays = {
    operational_redis: 3,
    verbose_payload: 14,
    verified_runtime_bundle: 90,
    compact_ledger: null,
  },
}: {
  now: number;
  entries: StrategyEvidenceRetentionEntry[];
  retentionDays?: Record<StrategyEvidenceRetentionEntry['kind'], number | null>;
}) => {
  const keep: StrategyEvidenceRetentionEntry[] = [];
  const remove: StrategyEvidenceRetentionEntry[] = [];
  for (const entry of entries) {
    const days = retentionDays[entry.kind];
    if (
      days == null ||
      !entry.verified ||
      !entry.aggregated ||
      now - entry.createdAt <= days * DAY_MS
    ) {
      keep.push(entry);
    } else {
      remove.push(entry);
    }
  }
  return {
    keep,
    delete: remove,
    bytesReclaimable: remove.reduce((total, entry) => total + entry.bytes, 0),
  };
};
