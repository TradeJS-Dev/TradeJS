/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  writeTickerProfiles,
  readTickerProfiles,
  tickerProfileFile,
} from '../tickerProfiles';
import type { TickerProfileSnapshot } from '@tradejs/types';
const snapshot: TickerProfileSnapshot = {
  schema: 'tradejs-ticker-profiles/v1',
  definition: 'hourly-30d-monthly-terciles/v1',
  provider: 'bybit',
  universeId: 'fixture',
  membership: 'frozen-list',
  asOf: Date.UTC(2026, 9, 1),
  validUntil: Date.UTC(2026, 10, 1),
  thresholds: { money: [null, null], volatility: [null, null] },
  profiles: [],
};
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ticker-profile-test-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('atomically freezes an idempotent snapshot and rejects conflicting recalculation', async () => {
  const ids = await Promise.all([
    writeTickerProfiles(root, snapshot),
    writeTickerProfiles(root, snapshot),
  ]);
  expect(ids[0]).toBe(ids[1]);
  expect(
    await readTickerProfiles(root, 'bybit', 'fixture', snapshot.asOf),
  ).toEqual({ snapshotId: ids[0], snapshot });
  await expect(
    writeTickerProfiles(root, {
      ...snapshot,
      thresholds: { ...snapshot.thresholds, money: [1, 2] },
    }),
  ).rejects.toThrow('different data');
});
it('distinguishes absent from corrupt snapshots and rejects traversal', async () => {
  expect(
    await readTickerProfiles(root, 'bybit', 'fixture', snapshot.asOf),
  ).toBeNull();
  await writeTickerProfiles(root, snapshot);
  await fs.writeFile(
    tickerProfileFile(root, 'bybit', 'fixture', snapshot.asOf),
    JSON.stringify({ payload: '{}', snapshotId: 'wrong' }),
  );
  await expect(
    readTickerProfiles(root, 'bybit', 'fixture', snapshot.asOf),
  ).rejects.toThrow('checksum');
  expect(() =>
    tickerProfileFile(root, '../bybit', 'fixture', snapshot.asOf),
  ).toThrow('Unsafe');
});
