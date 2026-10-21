import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  StrategyEvidenceRetentionEntry,
  StrategyResearchRetention,
} from '@tradejs/types';
import { planStrategyEvidenceRetention } from '../lib/strategyRelease/evidenceRetention';
import { applyResearchRetention } from '../lib/strategyRelease/researchRetention';

describe('completed research retention', () => {
  let root: string;
  let research: StrategyResearchRetention;
  let entry: StrategyEvidenceRetentionEntry;
  const hash = (text: string) =>
    createHash('sha256').update(text).digest('hex');
  const note =
    '---\nschema: tradejs-research/v1\nreproduction: complete\n---\n';
  const apply = (applyChanges = false) =>
    applyResearchRetention({
      projectRoot: root,
      research,
      entries: [entry],
      receiptPath: 'data/cleanup-receipt.json',
      apply: applyChanges,
    });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'research-retention-'));
    await fs.mkdir(path.join(root, 'data'));
    await fs.mkdir(path.join(root, 'notes'));
    const records = [
      { path: 'notes/result.md', role: 'note' as const, text: note },
      {
        path: 'data/candidates.json',
        role: 'candidates' as const,
        text: '{"resolvedConfig":{"MAX_LOSS_VALUE":10},"rejected":["candidate-a"]}',
      },
      {
        path: 'data/metrics.json',
        role: 'metrics' as const,
        text: '{"ALL":{"pnl":10},"LONG":{"pnl":10},"SHORT":{"pnl":0}}',
      },
    ];
    for (const record of records)
      await fs.writeFile(path.join(root, record.path), record.text);
    research = {
      researchId: 'example-study',
      status: 'completed',
      completedAt: Date.now() - 1000,
      permanentArtifacts: records.map(({ path: file, role, text }) => ({
        path: file,
        role,
        sha256: hash(text),
      })),
    };
    await fs.writeFile(path.join(root, 'data/trades.jsonl'), 'trade\n');
    entry = {
      path: 'data/trades.jsonl',
      kind: 'research_payload',
      researchId: research.researchId,
      sha256: hash('trade\n'),
      bytes: 6,
      createdAt: Date.now(),
      verified: true,
      aggregated: true,
    };
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('expires research files immediately after the final handoff, regardless of payload age', () => {
    const plan = planStrategyEvidenceRetention({
      now: Date.now(),
      research,
      entries: [entry, { ...entry, path: 'cache', kind: 'research_cache' }],
    });
    expect(plan.delete).toHaveLength(2);
    expect(plan.bytesReclaimable).toBe(12);
  });

  it.each(['running', 'blocked'] as const)(
    'keeps %s research even when files are old',
    (status) => {
      expect(
        planStrategyEvidenceRetention({
          now: Date.now(),
          research: { ...research, status },
          entries: [{ ...entry, createdAt: 0 }],
        }).delete,
      ).toEqual([]);
    },
  );

  it('keeps incomplete, foreign, unverified or unaggregated evidence', () => {
    for (const replacement of [
      { researchId: 'another-study' },
      { sha256: undefined },
      { verified: false },
      { aggregated: false },
    ]) {
      expect(
        planStrategyEvidenceRetention({
          now: Date.now(),
          research,
          entries: [{ ...entry, ...replacement }],
        }).delete,
      ).toEqual([]);
    }
    expect(
      planStrategyEvidenceRetention({ now: Date.now(), entries: [entry] })
        .delete,
    ).toEqual([]);
    expect(
      planStrategyEvidenceRetention({
        now: Date.now(),
        research: { ...research, permanentArtifacts: [] },
        entries: [entry],
      }).delete,
    ).toEqual([]);
    expect(
      planStrategyEvidenceRetention({
        now: Date.now(),
        research: { ...research, completedAt: Date.now() + 100000 },
        entries: [entry],
      }).delete,
    ).toEqual([]);
  });

  it('preflights without deleting, then keeps compact records and writes a deletion receipt', async () => {
    expect(await apply()).toMatchObject({ status: 'planned' });
    await expect(
      fs.readFile(path.join(root, entry.path), 'utf8'),
    ).resolves.toBe('trade\n');
    expect(await apply(true)).toMatchObject({
      status: 'completed',
      files: [{ removed: true, sha256: entry.sha256 }],
    });
    await expect(fs.access(path.join(root, entry.path))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    for (const artifact of research.permanentArtifacts)
      await expect(
        fs.access(path.join(root, artifact.path)),
      ).resolves.toBeUndefined();
    expect(
      JSON.parse(
        await fs.readFile(path.join(root, 'data/cleanup-receipt.json'), 'utf8'),
      ),
    ).toMatchObject({ status: 'completed', researchId: research.researchId });
  });

  it('checks all files before deleting any of them', async () => {
    const other = { ...entry, path: 'data/missing.jsonl' };
    await expect(
      applyResearchRetention({
        projectRoot: root,
        research,
        entries: [entry, other],
        receiptPath: 'data/receipt.json',
        apply: true,
      }),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(root, entry.path)),
    ).resolves.toBeUndefined();
  });

  it('rejects changed summaries and partial notes', async () => {
    await fs.appendFile(path.join(root, 'data/metrics.json'), ' ');
    await expect(apply(true)).rejects.toThrow('Permanent research artifact');
    research.permanentArtifacts = research.permanentArtifacts.filter(
      (artifact) => artifact.role !== 'metrics',
    );
    await expect(apply(true)).rejects.toThrow(
      'Missing permanent research metrics',
    );
    research.permanentArtifacts.push({
      path: 'data/metrics.json',
      role: 'metrics',
      sha256: hash(
        await fs.readFile(path.join(root, 'data/metrics.json'), 'utf8'),
      ),
    });
    const partial = note.replace('complete', 'partial');
    await fs.writeFile(path.join(root, 'notes/result.md'), partial);
    research.permanentArtifacts[0].sha256 = hash(partial);
    await expect(apply(true)).rejects.toThrow('reproduction: complete');
  });

  it('rejects paths outside data, protected files, symlinks and changed payloads', async () => {
    const original = entry;
    for (const file of [
      '../outside.jsonl',
      'notes/result.md',
      'data/candidates.json',
    ]) {
      entry = { ...original, path: file };
      await expect(apply(true)).rejects.toThrow(
        'Not a disposable research file',
      );
    }
    entry = { ...original, path: 'data/link.jsonl' };
    await fs.symlink(
      path.join(root, original.path),
      path.join(root, entry.path),
    );
    await expect(apply(true)).rejects.toThrow('refuses symlinks');
    entry = original;
    await fs.writeFile(path.join(root, entry.path), 'other\n');
    await expect(apply(true)).rejects.toThrow('checksum/size mismatch');
  });

  it('refuses files still open by a research consumer', async () => {
    const handle = await fs.open(path.join(root, entry.path), 'r');
    try {
      await expect(apply(true)).rejects.toThrow('open files');
    } finally {
      await handle.close();
    }
  });

  it('retires an incomplete old study without relabelling its metrics as complete', async () => {
    const partial = note.replace('complete', 'blocked');
    await fs.writeFile(path.join(root, 'notes/result.md'), partial);
    research = {
      ...research,
      status: 'retired',
      retirement: {
        policy: 'discard-unrecoverable-without-rerun',
        reason: 'Owner requests disposal without a rerun.',
        missingEvidence: ['Original configuration cannot be recovered.'],
      },
      permanentArtifacts: [
        { path: 'notes/result.md', role: 'note', sha256: hash(partial) },
      ],
    };
    entry.aggregated = false;
    expect(
      planStrategyEvidenceRetention({
        now: Date.now(),
        research,
        entries: [entry],
      }).delete,
    ).toHaveLength(1);
    expect(await apply(true)).toMatchObject({
      status: 'completed',
      retirement: research.retirement,
    });
    await expect(
      fs.readFile(path.join(root, 'notes/result.md'), 'utf8'),
    ).resolves.toBe(partial);
  });

  it('requires an explicit retirement reason and missing-evidence record', async () => {
    research.status = 'retired';
    expect(
      planStrategyEvidenceRetention({
        now: Date.now(),
        research,
        entries: [entry],
      }).delete,
    ).toEqual([]);
    await expect(apply(true)).rejects.toThrow('must be completed');
    research.retirement = {
      policy: 'discard-unrecoverable-without-rerun',
      reason: '',
      missingEvidence: [],
    };
    expect(
      planStrategyEvidenceRetention({
        now: Date.now(),
        research,
        entries: [entry],
      }).delete,
    ).toEqual([]);
  });
});
