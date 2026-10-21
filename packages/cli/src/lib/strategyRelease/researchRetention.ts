import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { strategyEvidenceFileSha256 } from '@tradejs/infra/strategyReleaseEvidence';
import type {
  StrategyEvidenceRetentionEntry,
  StrategyResearchRetention,
} from '@tradejs/types';
import { assertNoResearchFileConsumers } from './researchFileConsumers';
import { isResearchRetired } from './evidenceRetention';

const SHA256_RE = /^[a-f0-9]{64}$/;

// Bound filesystem concurrency independently of the size of the inventory.
const mapFiles = async <T, R>(
  entries: T[],
  visit: (entry: T) => Promise<R>,
) => {
  const results = new Array<R>(entries.length);
  let next = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(8, entries.length) }, async () => {
      while (next < entries.length) {
        const index = next++;
        results[index] = await visit(entries[index]);
      }
    }),
  );
  for (const worker of workers)
    if (worker.status === 'rejected') throw worker.reason;
  return results;
};

const fileSha256 = async (file: string, bytes: number) =>
  bytes <= 1024 * 1024
    ? createHash('sha256')
        .update(await fs.readFile(file))
        .digest('hex')
    : strategyEvidenceFileSha256(file);

const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
};

/** Research cleanup is an explicit, checksum-bound post-handoff operation. */
export const applyResearchRetention = async (options: {
  projectRoot: string;
  research: StrategyResearchRetention;
  entries: StrategyEvidenceRetentionEntry[];
  receiptPath: string;
  apply: boolean;
  protectedPaths?: string[];
}) => {
  const projectRoot = await fs.realpath(options.projectRoot);
  const dataRoot = path.join(projectRoot, 'data');
  const resolve = (file: string) => path.resolve(projectRoot, file);
  const receiptPath = resolve(options.receiptPath);
  const journalPath = `${receiptPath}.deleted.jsonl`;
  const permanent = new Set(
    options.research.permanentArtifacts.map((entry) => resolve(entry.path)),
  );
  if (
    !inside(projectRoot, receiptPath) ||
    permanent.has(receiptPath) ||
    permanent.has(journalPath)
  ) {
    throw new Error(
      'Cleanup receipt must be separate from permanent research artifacts',
    );
  }
  permanent.add(receiptPath);
  permanent.add(journalPath);
  for (const file of options.protectedPaths ?? []) permanent.add(resolve(file));
  const retired = isResearchRetired(options.research);
  if (
    (options.research.status !== 'completed' && !retired) ||
    !Number.isFinite(options.research.completedAt) ||
    options.research.completedAt! > Date.now()
  ) {
    throw new Error('Research must be completed before cleanup');
  }
  for (const role of retired ? ['note'] : ['note', 'candidates', 'metrics']) {
    if (
      !options.research.permanentArtifacts.some((entry) => entry.role === role)
    ) {
      throw new Error(`Missing permanent research ${role}`);
    }
  }
  await mapFiles(options.research.permanentArtifacts, async (artifact) => {
    const file = resolve(artifact.path);
    if (
      !inside(projectRoot, await fs.realpath(file)) ||
      !SHA256_RE.test(artifact.sha256) ||
      (await fileSha256(file, (await fs.stat(file)).size)) !== artifact.sha256
    ) {
      throw new Error(
        `Permanent research artifact checksum/path mismatch: ${file}`,
      );
    }
    if (artifact.role === 'note') {
      const handle = await fs.open(file, 'r');
      try {
        const header = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const frontmatter = header
          .subarray(0, bytesRead)
          .toString('utf8')
          .match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (
          !frontmatter ||
          !/^schema:\s*tradejs-research\/v1\s*$/m.test(frontmatter[1]) ||
          !(retired
            ? /^reproduction:\s*(?:complete|partial|blocked|legacy-partial)\s*$/m.test(
                frontmatter[1],
              )
            : /^reproduction:\s*complete\s*$/m.test(frontmatter[1]))
        ) {
          throw new Error(
            `Research note must have reproduction: complete: ${file}`,
          );
        }
      } finally {
        await handle.close();
      }
    }
  });
  const checkedPaths = new Set<string>();
  const checked = await mapFiles(options.entries, async (entry) => {
    const file = resolve(entry.path);
    if (
      !['research_payload', 'research_cache'].includes(entry.kind) ||
      entry.researchId !== options.research.researchId ||
      !entry.verified ||
      (!entry.aggregated && !retired) ||
      !SHA256_RE.test(entry.sha256 ?? '') ||
      !inside(dataRoot, file) ||
      permanent.has(file) ||
      /\.(?:md|patch|diff)$/i.test(file)
    ) {
      throw new Error(`Not a disposable research file: ${file}`);
    }
    if (checkedPaths.has(file))
      throw new Error(`Duplicate cleanup path: ${file}`);
    checkedPaths.add(file);
    // Reject directory symlinks as well as symlinked files.
    if ((await fs.realpath(file)) !== file)
      throw new Error(`Research cleanup refuses symlinks: ${file}`);
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.size !== entry.bytes ||
      (await fileSha256(file, stat.size)) !== entry.sha256
    ) {
      throw new Error(
        `Disposable research file checksum/size mismatch: ${file}`,
      );
    }
    return { entry, file, mtimeMs: stat.mtimeMs, ino: stat.ino };
  });
  // Do this after hashing and before unlinking. A finished run must have no
  // open readers/writers, including another research workflow using its export.
  await assertNoResearchFileConsumers(checked.map((entry) => entry.file));
  const receipt = {
    schema: 'tradejs-research-cleanup-receipt/v1',
    researchId: options.research.researchId,
    completedAt: options.research.completedAt,
    ...(retired ? { retirement: options.research.retirement } : {}),
    journalPath,
    permanentArtifacts: options.research.permanentArtifacts,
    scope:
      'reported aggregates and frozen candidates; new trade-level analyses require a rerun',
    status: 'planned' as 'planned' | 'applying' | 'completed',
    files: checked.map(({ entry, file }) => ({
      path: file,
      sha256: entry.sha256,
      bytes: entry.bytes,
      removed: false,
    })),
  };
  if (!options.apply) return receipt;
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  if (
    (await fs.realpath(path.dirname(receiptPath))) !== path.dirname(receiptPath)
  ) {
    throw new Error('Cleanup receipt refuses symlinked directories');
  }
  const lock = await fs.open(`${receiptPath}.lock`, 'wx');
  let journal: Awaited<ReturnType<typeof fs.open>> | undefined;
  const writeReceipt = async () => {
    const temp = `${receiptPath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await fs.rename(temp, receiptPath);
  };
  try {
    journal = await fs.open(journalPath, 'wx');
    receipt.status = 'applying';
    await writeReceipt();
    for (let index = 0; index < checked.length; index += 1) {
      const { file, entry, ino, mtimeMs } = checked[index];
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.ino !== ino ||
        stat.mtimeMs !== mtimeMs ||
        stat.size !== entry.bytes
      ) {
        throw new Error(`Research file changed during cleanup: ${file}`);
      }
      await fs.unlink(file);
      receipt.files[index].removed = true;
      await journal.write(`${JSON.stringify(receipt.files[index])}\n`);
    }
    receipt.status = 'completed';
    await writeReceipt();
    return receipt;
  } catch (error) {
    if (journal) await writeReceipt();
    throw error;
  } finally {
    await journal?.close();
    await lock.close();
    await fs.unlink(`${receiptPath}.lock`);
  }
};
