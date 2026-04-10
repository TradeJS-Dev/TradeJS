const parseTimestampMs = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1e12 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
};

const LOOKAHEAD_TS_KEY_RE = /(Timestamp|Ts|AtMs)$/;

export type LookaheadViolation = {
  key: string;
  entryTimestampMs: number;
  featureTimestampMs: number;
};

export const isTimestampFeatureKey = (key: string): boolean => {
  if (!key || key === 'entryTimestamp') return false;
  return LOOKAHEAD_TS_KEY_RE.test(key);
};

export const findLookaheadViolations = (
  row: Record<string, unknown>,
): LookaheadViolation[] => {
  const entryTimestampMs = parseTimestampMs(row.entryTimestamp);
  if (!entryTimestampMs) return [];
  const violations: LookaheadViolation[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (!isTimestampFeatureKey(key)) continue;
    const featureTimestampMs = parseTimestampMs(value);
    if (!featureTimestampMs) continue;
    if (featureTimestampMs > entryTimestampMs) {
      violations.push({
        key,
        entryTimestampMs,
        featureTimestampMs,
      });
    }
  }
  return violations;
};
