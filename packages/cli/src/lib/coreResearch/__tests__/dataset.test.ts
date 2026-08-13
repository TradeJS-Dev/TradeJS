import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCoreResearchVariant, resolveCoreResearchRegime } from '../dataset';
import { sha256File } from '../io';
import {
  DAY_MS,
  makeDatasetRow,
  makeVariant,
  START,
} from '../__fixtures__/fixtures';

const writeRows = async (filePath: string, rows: unknown[]) => {
  await fs.writeFile(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
};

describe('core research dataset reader', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'core-dataset-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('streams a run-scoped export, preserves its exact hash, and orders trades deterministically', async () => {
    const filePath = path.join(tempRoot, 'rows.jsonl');
    await writeRows(filePath, [
      makeDatasetRow({
        signalId: 'later',
        setupIdentity: 'setup-later',
        timestamp: START + 2_000,
      }),
      makeDatasetRow({
        signalId: 'different-run',
        setupIdentity: 'setup-other',
        runId: 'other-run',
      }),
      makeDatasetRow({ signalId: 'no-result', includeTradeResult: false }),
      makeDatasetRow({
        signalId: 'earlier',
        setupIdentity: 'setup-earlier',
        timestamp: START,
      }),
    ]);

    const loaded = await readCoreResearchVariant(
      makeVariant({
        id: 'candidate',
        role: 'candidate',
        files: [filePath],
        runId: 'fixture-run',
      }),
    );

    expect(loaded.files).toEqual([
      expect.objectContaining({
        path: filePath,
        sha256: await sha256File(filePath),
        rows: 4,
        selectedTrades: 2,
        rowsForDifferentRun: 1,
        rowsWithoutTradeResult: 1,
      }),
    ]);
    expect(loaded.trades.map((trade) => trade.signalId)).toEqual([
      'earlier',
      'later',
    ]);
    expect(new Set(loaded.trades.map((trade) => trade.sourceSha256))).toEqual(
      new Set([await sha256File(filePath)]),
    );
  });

  it('uses explicit, strategy-context, and causal fallback setup identities in that order', async () => {
    const filePath = path.join(tempRoot, 'identities.jsonl');
    await writeRows(filePath, [
      makeDatasetRow({ signalId: 'explicit', setupIdentity: 'explicit-id' }),
      makeDatasetRow({
        signalId: 'context',
        timestamp: START + 1_000,
        strategyContext: { setup: { patternId: 'pattern-7' } },
      }),
      makeDatasetRow({ signalId: 'fallback', timestamp: START + 2_000 }),
    ]);

    const { trades } = await readCoreResearchVariant(
      makeVariant({
        id: 'candidate',
        role: 'candidate',
        files: [filePath],
      }),
    );

    expect(
      trades.map((trade) => [trade.setupIdentitySource, trade.setupIdentity]),
    ).toEqual([
      ['research.setupIdentity', 'explicit-id'],
      ['strategy-context', 'FixtureStrategy|AAAUSDT|LONG|patternId:pattern-7'],
      ['signal-time-fallback', `FixtureStrategy|AAAUSDT|LONG|${START + 2_000}`],
    ]);
  });

  it('drops byte-equivalent duplicate trades but rejects conflicting duplicates', async () => {
    const firstPath = path.join(tempRoot, 'first.jsonl');
    const secondPath = path.join(tempRoot, 'second.jsonl');
    const row = makeDatasetRow({ signalId: 'same', setupIdentity: 'same' });
    await writeRows(firstPath, [row]);
    await writeRows(secondPath, [row]);

    const duplicate = await readCoreResearchVariant(
      makeVariant({
        id: 'candidate',
        role: 'candidate',
        files: [firstPath, secondPath],
      }),
    );
    expect(duplicate.trades).toHaveLength(1);
    expect(duplicate.duplicateRowsDropped).toBe(1);

    await writeRows(secondPath, [
      makeDatasetRow({
        signalId: 'same',
        setupIdentity: 'same',
        netProfit: -10,
      }),
    ]);
    await expect(
      readCoreResearchVariant(
        makeVariant({
          id: 'candidate',
          role: 'candidate',
          files: [firstPath, secondPath],
        }),
      ),
    ).rejects.toThrow('Conflicting completed trades share identity');
  });

  it('aggregates separately attributed scale-in legs into one position cycle', async () => {
    const filePath = path.join(tempRoot, 'scale-in.jsonl');
    await writeRows(filePath, [
      makeDatasetRow({
        signalId: 'grid-open',
        setupIdentity: 'open-setup',
        positionCycleId: 'grid-open',
        timestamp: START,
        qty: 1,
        entryPrice: 100,
        exitTimestamp: START + DAY_MS / 2,
        netProfit: 1.25,
      }),
      makeDatasetRow({
        signalId: 'grid-increase-2',
        setupIdentity: 'increase-setup',
        positionCycleId: 'grid-open',
        timestamp: START + 1_000,
        qty: 2,
        entryPrice: 90,
        exitTimestamp: START + DAY_MS / 2,
        netProfit: 2.75,
      }),
    ]);

    const loaded = await readCoreResearchVariant(
      makeVariant({
        id: 'candidate',
        role: 'candidate',
        files: [filePath],
      }),
    );

    expect(loaded.files[0]).toEqual(
      expect.objectContaining({ selectedTrades: 2 }),
    );
    expect(loaded.trades).toEqual([
      expect.objectContaining({
        signalId: 'grid-open',
        positionCycleId: 'grid-open',
        setupIdentity: 'open-setup',
        signalTimestamp: START,
        entryTimestamp: START + 1_000,
        entryPrice: (100 + 90 * 2) / 3,
        qty: 3,
        netProfit: 4,
        grossProfit: 8,
        totalFee: 4,
      }),
    ]);
  });

  it('rejects an incomplete position cycle without its opening row', async () => {
    const filePath = path.join(tempRoot, 'orphan-increase.jsonl');
    await writeRows(filePath, [
      makeDatasetRow({
        signalId: 'grid-increase-2',
        positionCycleId: 'grid-open',
      }),
    ]);

    await expect(
      readCoreResearchVariant(
        makeVariant({
          id: 'candidate',
          role: 'candidate',
          files: [filePath],
        }),
      ),
    ).rejects.toThrow('must contain exactly one opening row');
  });

  it('rejects completed rows without a stable signal identity', async () => {
    const filePath = path.join(tempRoot, 'missing-signal.jsonl');
    const row = makeDatasetRow();
    delete (row as { signalId?: string }).signalId;
    delete (row.tradeResult as { signalId?: string }).signalId;
    await writeRows(filePath, [row]);

    await expect(
      readCoreResearchVariant(
        makeVariant({
          id: 'candidate',
          role: 'candidate',
          files: [filePath],
        }),
      ),
    ).rejects.toThrow('signalId must be non-empty');
  });

  it('classifies only signal-time regime payloads and supports documented fallbacks', () => {
    const row = makeDatasetRow();
    row.payload.additionalIndicators = {
      baseContext: {
        regime: {
          trend: { bias: 'bear' },
          volatility: { state: 'expanded' },
        },
        gateFeatures: {
          relative: {
            btcAltRegime: 'btc_lead',
            marketBreadthReturn: -0.02,
          },
        },
        derivatives: {
          targetContext: { summary: { pressure: 'crowded_short' } },
        },
      },
    };

    expect(resolveCoreResearchRegime(row)).toEqual({
      trend: 'bear',
      volatility: 'expanded',
      breadth: 'mixed',
      derivatives: 'crowded',
      key: 'bear|expanded|mixed|crowded',
    });
  });

  it('reports malformed JSON with the exact source line', async () => {
    const filePath = path.join(tempRoot, 'bad.jsonl');
    await fs.writeFile(filePath, '{}\n{bad}\n', 'utf8');
    await expect(
      readCoreResearchVariant(
        makeVariant({
          id: 'candidate',
          role: 'candidate',
          files: [filePath],
        }),
      ),
    ).rejects.toThrow(`${filePath}:2 contains invalid JSON`);
  });
});
