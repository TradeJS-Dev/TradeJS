import type {
  StrategyEvidenceRetentionEntry,
  StrategyResearchRetention,
} from '@tradejs/types';

const DAY_MS = 86_400_000;

export const isResearchRetired = (research?: StrategyResearchRetention) =>
  research?.status === 'retired' &&
  research.retirement?.policy === 'discard-unrecoverable-without-rerun' &&
  Boolean(research.retirement.reason.trim()) &&
  Boolean(research.retirement.missingEvidence.length) &&
  research.retirement.missingEvidence.every((item) => Boolean(item.trim()));

export const planStrategyEvidenceRetention = ({
  now,
  entries,
  research,
  retentionDays = {
    operational_redis: 3,
    verbose_payload: 14,
    research_payload: 0,
    research_cache: 0,
    verified_runtime_bundle: 90,
    compact_ledger: null,
  },
}: {
  now: number;
  entries: StrategyEvidenceRetentionEntry[];
  research?: StrategyResearchRetention;
  retentionDays?: Record<StrategyEvidenceRetentionEntry['kind'], number | null>;
}) => {
  const keep: StrategyEvidenceRetentionEntry[] = [];
  const remove: StrategyEvidenceRetentionEntry[] = [];
  const retired = isResearchRetired(research);
  const roles = new Set(
    research?.permanentArtifacts.map((artifact) => artifact.role),
  );
  const terminalResearch = Boolean(
    (research?.status === 'completed' || retired) &&
      Number.isFinite(research?.completedAt) &&
      research!.completedAt! <= now &&
      (retired ? ['note'] : ['note', 'candidates', 'metrics']).every((role) =>
        roles.has(role as 'note' | 'candidates' | 'metrics'),
      ),
  );
  for (const entry of entries) {
    const days = retentionDays[entry.kind];
    const isResearch =
      entry.kind === 'research_payload' || entry.kind === 'research_cache';
    const completedResearch = Boolean(
      terminalResearch &&
        research?.researchId === entry.researchId &&
        /^[a-f0-9]{64}$/.test(entry.sha256 ?? ''),
    );
    if (
      (isResearch && !completedResearch) ||
      days == null ||
      !entry.verified ||
      (!entry.aggregated && !(isResearch && retired)) ||
      (!isResearch && now - entry.createdAt <= days * DAY_MS)
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
