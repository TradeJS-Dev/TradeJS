import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { TickerProfileSnapshot } from '@tradejs/types';

const segment = (value: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new Error('Unsafe ticker profile identity');
  return value;
};
export const tickerProfileFile = (
  root: string,
  provider: string,
  universeId: string,
  asOf: number,
): string => {
  if (!Number.isSafeInteger(asOf) || asOf < 0)
    throw new Error('Invalid profile timestamp');
  return path.join(
    root,
    'data',
    'market',
    'ticker-profiles',
    segment(provider),
    segment(universeId),
    `${asOf}.json`,
  );
};
const digest = (data: string) =>
  createHash('sha256').update(data).digest('hex');

/** Immutable monthly snapshot; atomic publication, conflicting recalculation is rejected. */
export const writeTickerProfiles = async (
  root: string,
  snapshot: TickerProfileSnapshot,
): Promise<string> => {
  const payload = JSON.stringify(snapshot),
    snapshotId = digest(payload);
  const file = tickerProfileFile(
    root,
    snapshot.provider,
    snapshot.universeId,
    snapshot.asOf,
  );
  const envelope = JSON.stringify({ snapshotId, payload });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, envelope, { flag: 'wx' });
  try {
    try {
      await fs.link(temporary, file);
    } catch (error) {
      if (
        !(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'EEXIST'
        )
      )
        throw error;
      if ((await fs.readFile(file, 'utf8')) !== envelope)
        throw new Error(
          `Ticker profile already frozen with different data: ${file}`,
        );
    }
  } finally {
    await fs.unlink(temporary);
  }
  return snapshotId;
};

export const readTickerProfiles = async (
  root: string,
  provider: string,
  universeId: string,
  asOf: number,
): Promise<{ snapshotId: string; snapshot: unknown } | null> => {
  let content: string;
  try {
    content = await fs.readFile(
      tickerProfileFile(root, provider, universeId, asOf),
      'utf8',
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return null;
    throw error;
  }
  const envelope: unknown = JSON.parse(content);
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    !('payload' in envelope) ||
    typeof envelope.payload !== 'string' ||
    !('snapshotId' in envelope) ||
    envelope.snapshotId !== digest(envelope.payload)
  )
    throw new Error('Ticker profile checksum mismatch');
  return {
    snapshotId: String(envelope.snapshotId),
    snapshot: JSON.parse(envelope.payload),
  };
};
