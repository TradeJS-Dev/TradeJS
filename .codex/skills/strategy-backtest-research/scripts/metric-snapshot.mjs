import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'tradejs-metric-snapshot/v1';
const MAX_BYTES = 256 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const validatePermanentMetrics = (value) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (
      ['matchedPairs', 'tradeRows', 'allProjectedLeaves'].includes(key) &&
      Array.isArray(child) &&
      child.length
    ) {
      throw new Error(`Temporary payload ${key} is not a permanent metric`);
    }
    if (
      key === 'trades' &&
      Array.isArray(child) &&
      child.some(
        (row) =>
          row &&
          typeof row === 'object' &&
          ('signalId' in row || 'entryTimestamp' in row),
      )
    ) {
      throw new Error('Temporary trade records are not permanent metrics');
    }
    validatePermanentMetrics(child);
  }
};

export const encodeMetricSnapshot = (metrics) => {
  validatePermanentMetrics(metrics);
  const bytes = Buffer.from(JSON.stringify(metrics));
  if (bytes.length > MAX_BYTES)
    throw new Error('Metric snapshot exceeds decoded size limit');
  return {
    schema: SCHEMA,
    encoding: 'gzip+base64',
    decodedBytes: bytes.length,
    sha256: sha256(bytes),
    payload: gzipSync(bytes, { level: 9 }).toString('base64'),
  };
};

export const decodeMetricSnapshot = (snapshot) => {
  if (
    snapshot?.schema !== SCHEMA ||
    snapshot.encoding !== 'gzip+base64' ||
    !Number.isSafeInteger(snapshot.decodedBytes) ||
    snapshot.decodedBytes <= 0 ||
    snapshot.decodedBytes > MAX_BYTES ||
    typeof snapshot.payload !== 'string' ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256)
  ) {
    throw new Error('Invalid metric snapshot envelope');
  }
  const bytes = gunzipSync(Buffer.from(snapshot.payload, 'base64'), {
    maxOutputLength: snapshot.decodedBytes,
  });
  if (
    bytes.length !== snapshot.decodedBytes ||
    sha256(bytes) !== snapshot.sha256
  )
    throw new Error('Metric snapshot checksum or size mismatch');
  const metrics = JSON.parse(bytes.toString('utf8'));
  validatePermanentMetrics(metrics);
  return metrics;
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [mode, input, output] = process.argv.slice(2);
  if (!['encode', 'decode'].includes(mode) || !input || !output)
    throw new Error('Use encode|decode <input.json> <new-output.json>');
  const content = await fs.readFile(input, 'utf8');
  const section =
    mode === 'decode' && input.endsWith('.md')
      ? content
          .split('## Metrics snapshot (machine-readable)')[1]
          ?.split('## Reported metrics')[0]
      : undefined;
  const blocks =
    section == null
      ? []
      : [...section.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
  if (mode === 'decode' && input.endsWith('.md') && blocks.length !== 1)
    throw new Error('Note needs one compact metric snapshot');
  const value = JSON.parse(blocks[0]?.[1] ?? content);
  const result =
    mode === 'encode'
      ? encodeMetricSnapshot(value)
      : decodeMetricSnapshot(value);
  await fs.writeFile(output, `${JSON.stringify(result)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, schema: result?.schema ?? null }));
}
