import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const MAX_BYTES = 256 * 1024 * 1024;
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

export const validatePermanentResearchMetrics = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (
      ['matchedPairs', 'tradeRows', 'allProjectedLeaves'].includes(key) &&
      Array.isArray(child) &&
      child.length
    )
      throw new Error(`Temporary payload ${key} is not a permanent metric`);
    if (
      key === 'trades' &&
      Array.isArray(child) &&
      child.some(
        (row) =>
          row &&
          typeof row === 'object' &&
          ('signalId' in row || 'entryTimestamp' in row),
      )
    )
      throw new Error('Temporary trade records are not permanent metrics');
    validatePermanentResearchMetrics(child);
  }
};

export const encodeResearchMetricSnapshot = (metrics: unknown) => {
  validatePermanentResearchMetrics(metrics);
  const bytes = Buffer.from(JSON.stringify(metrics));
  if (bytes.length > MAX_BYTES)
    throw new Error('Metric snapshot exceeds decoded size limit');
  return {
    schema: 'tradejs-metric-snapshot/v1',
    encoding: 'gzip+base64',
    decodedBytes: bytes.length,
    sha256: hash(bytes),
    payload: gzipSync(bytes, { level: 9 }).toString('base64'),
  };
};

export const decodeResearchMetricSnapshot = (snapshot: unknown): unknown => {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !('schema' in snapshot) ||
    snapshot.schema !== 'tradejs-metric-snapshot/v1' ||
    !('encoding' in snapshot) ||
    snapshot.encoding !== 'gzip+base64' ||
    !('decodedBytes' in snapshot) ||
    typeof snapshot.decodedBytes !== 'number' ||
    !Number.isSafeInteger(snapshot.decodedBytes) ||
    snapshot.decodedBytes <= 0 ||
    snapshot.decodedBytes > MAX_BYTES ||
    !('sha256' in snapshot) ||
    typeof snapshot.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
    !('payload' in snapshot) ||
    typeof snapshot.payload !== 'string'
  )
    throw new Error('Invalid metric snapshot envelope');
  const bytes = gunzipSync(Buffer.from(snapshot.payload, 'base64'), {
    maxOutputLength: snapshot.decodedBytes,
  });
  if (bytes.length !== snapshot.decodedBytes || hash(bytes) !== snapshot.sha256)
    throw new Error('Metric snapshot checksum or size mismatch');
  const metrics: unknown = JSON.parse(bytes.toString('utf8'));
  validatePermanentResearchMetrics(metrics);
  return metrics;
};
