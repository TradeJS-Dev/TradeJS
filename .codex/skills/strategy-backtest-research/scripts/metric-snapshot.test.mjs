import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeMetricSnapshot,
  decodeMetricSnapshot,
} from './metric-snapshot.mjs';

test('compact snapshot preserves all candidates, zero/null metrics, config and chart data independently of external files', () => {
  const metrics = {
    config: { enabled: false },
    candidates: Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      verdict: 'rejected',
      periods: {
        full: {
          ALL: { trades: 0, pnl: 0, pf: null },
          LONG: { pnl: -5 },
          SHORT: { pnl: 3 },
        },
      },
      chart: [
        [0, 0],
        [1, -2],
      ],
    })),
  };
  const encoded = encodeMetricSnapshot(metrics);
  assert.deepEqual(
    decodeMetricSnapshot(JSON.parse(JSON.stringify(encoded))),
    metrics,
  );
  assert.ok(
    JSON.stringify(encoded).length < JSON.stringify(metrics).length / 5,
  );
  assert.deepEqual(encodeMetricSnapshot(metrics), encoded);
  assert.throws(
    () => decodeMetricSnapshot({ ...encoded, sha256: '0'.repeat(64) }),
    /checksum/,
  );
  assert.throws(
    () => decodeMetricSnapshot({ ...encoded, decodedBytes: 1024 ** 3 }),
    /Invalid/,
  );
  assert.throws(
    () =>
      decodeMetricSnapshot({
        ...encoded,
        decodedBytes: encoded.decodedBytes + 1,
      }),
    /size mismatch/,
  );
});

test('temporary payloads cannot be hidden in a compressed permanent snapshot', () => {
  for (const key of ['matchedPairs', 'tradeRows', 'allProjectedLeaves']) {
    assert.throws(
      () => encodeMetricSnapshot({ nested: { [key]: [{}] } }),
      /Temporary payload/,
    );
  }
  assert.throws(
    () => encodeMetricSnapshot({ trades: [{ signalId: 's' }] }),
    /Temporary trade/,
  );
  assert.deepEqual(
    decodeMetricSnapshot(encodeMetricSnapshot({ trades: 0, matchedPairs: [] })),
    { trades: 0, matchedPairs: [] },
  );
});
