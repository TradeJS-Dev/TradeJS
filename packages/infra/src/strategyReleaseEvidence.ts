import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  STRATEGY_EVIDENCE_MARKERS_SCHEMA,
  type StrategyEvidenceMarkerEnvelope,
  type StrategyEvidenceMarkerPayload,
  type StrategyEvidenceMarkerType,
} from '@tradejs/types';

const SHA256_RE = /^[a-f0-9]{64}$/;
const LINEAGE_FINGERPRINT_RE = /^[a-f0-9]{16}$/;
const MARKER_TYPES = new Set<StrategyEvidenceMarkerType>([
  'G',
  'L',
  'E',
  'D',
  'P',
  'R',
]);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const canonicalStrategyEvidenceJson = (value: unknown): string => {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    const record = asRecord(current);
    if (!record) return current;
    return Object.fromEntries(
      Object.entries(record)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  };
  return JSON.stringify(normalize(value));
};

export const strategyEvidenceSha256 = (value: unknown) =>
  createHash('sha256')
    .update(canonicalStrategyEvidenceJson(value))
    .digest('hex');

export const strategyEvidenceFingerprint = (value: unknown) =>
  strategyEvidenceSha256(value).slice(0, 16);

export const strategyEvidenceFileSha256 = async (filePath: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

export const safeStrategyEvidenceSegment = (
  value: string,
  fallback = 'strategy',
) => {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return safe && safe !== '.' && safe !== '..' ? safe : fallback;
};

export const compactStrategyEvidenceTimestamp = (timestamp: number) =>
  new Date(timestamp)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.000Z$/, 'Z');

export const createStrategyEvidenceMarkerEnvelope = (
  payload: StrategyEvidenceMarkerPayload,
): StrategyEvidenceMarkerEnvelope => {
  const payloadSha256 = strategyEvidenceSha256(payload);
  return {
    schema: STRATEGY_EVIDENCE_MARKERS_SCHEMA,
    artifactId: `${safeStrategyEvidenceSegment(payload.strategy)}_${compactStrategyEvidenceTimestamp(payload.createdAt)}_${payloadSha256.slice(0, 16)}`,
    payloadSha256,
    payload,
  };
};

export const verifyStrategyEvidenceMarkerEnvelope = (
  value: unknown,
): StrategyEvidenceMarkerEnvelope => {
  const envelope = asRecord(value);
  const payload = asRecord(envelope?.payload);
  if (
    envelope?.schema !== STRATEGY_EVIDENCE_MARKERS_SCHEMA ||
    !isString(envelope.artifactId) ||
    !isString(envelope.payloadSha256) ||
    !SHA256_RE.test(envelope.payloadSha256) ||
    !payload ||
    !isString(payload.strategy) ||
    !isNumber(payload.createdAt) ||
    !Array.isArray(payload.markers) ||
    !Array.isArray(payload.sourceArtifacts)
  ) {
    throw new Error('Invalid strategy evidence marker envelope');
  }
  for (const value of payload.markers) {
    const marker = asRecord(value);
    const coverage = asRecord(marker?.coverage);
    if (
      !marker ||
      !isString(marker.id) ||
      !isString(marker.type) ||
      !MARKER_TYPES.has(marker.type as StrategyEvidenceMarkerType) ||
      !isNumber(marker.timestamp) ||
      !isString(marker.label) ||
      !isString(marker.summary) ||
      !isString(marker.artifactId) ||
      !isString(marker.artifactSha256) ||
      !SHA256_RE.test(marker.artifactSha256) ||
      (marker.gitSha !== undefined && !isString(marker.gitSha)) ||
      (marker.gateFingerprint !== undefined &&
        (!isString(marker.gateFingerprint) ||
          !LINEAGE_FINGERPRINT_RE.test(marker.gateFingerprint))) ||
      (marker.configFingerprint !== undefined &&
        (!isString(marker.configFingerprint) ||
          !LINEAGE_FINGERPRINT_RE.test(marker.configFingerprint))) ||
      (marker.contextFingerprint !== undefined &&
        (!isString(marker.contextFingerprint) ||
          !LINEAGE_FINGERPRINT_RE.test(marker.contextFingerprint))) ||
      (marker.maxLossValue !== undefined && !isNumber(marker.maxLossValue)) ||
      (marker.coverage !== undefined &&
        (!coverage ||
          !isNumber(coverage.startTime) ||
          !isNumber(coverage.endTime) ||
          coverage.startTime > coverage.endTime))
    ) {
      throw new Error('Invalid strategy evidence marker');
    }
  }
  for (const value of payload.sourceArtifacts) {
    const artifact = asRecord(value);
    if (
      !artifact ||
      !isString(artifact.artifactId) ||
      !isString(artifact.sha256) ||
      !SHA256_RE.test(artifact.sha256) ||
      (artifact.path !== undefined && typeof artifact.path !== 'string')
    ) {
      throw new Error('Invalid strategy evidence source artifact');
    }
  }

  const payloadSha256 = strategyEvidenceSha256(payload);
  if (payloadSha256 !== envelope.payloadSha256) {
    throw new Error('Strategy evidence marker checksum mismatch');
  }
  const expectedId = `${safeStrategyEvidenceSegment(payload.strategy)}_${compactStrategyEvidenceTimestamp(payload.createdAt)}_${payloadSha256.slice(0, 16)}`;
  if (expectedId !== envelope.artifactId) {
    throw new Error('Strategy evidence marker artifact identity mismatch');
  }
  return value as StrategyEvidenceMarkerEnvelope;
};
