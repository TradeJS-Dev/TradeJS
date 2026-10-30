import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  StrategyEvidenceRetentionEntry,
  StrategyResearchRetention,
} from '@tradejs/types';
import { applyResearchRetention } from '../strategyRelease/researchRetention';
import { sha256File, writeJsonAtomic } from '../coreResearch/io';
import { boundResearchPath, readJson } from './io';
import type { ResearchState, StrategyResearchSpec } from './types';

type Inventory = {
  research: StrategyResearchRetention;
  entries: StrategyEvidenceRetentionEntry[];
};
type Receipt = {
  status: string;
  files: Array<{ path: string; sha256: string; removed: boolean }>;
};

/** Freeze only files owned by this workflow. Imported inputs are never disposable. */
export const createResearchRetentionInventory = async (
  projectRoot: string,
  directory: string,
  spec: StrategyResearchSpec,
  state: ResearchState,
  notePath: string,
): Promise<Inventory> => {
  const permanentArtifacts: StrategyResearchRetention['permanentArtifacts'] =
    [];
  for (const [role, file] of [
    ['note', notePath],
    ['metrics', path.join(directory, 'result.json')],
    ['candidates', path.join(directory, '03-freeze-gates/result.json')],
    ['candidates', path.join(directory, 'resolved-spec.json')],
    ['ledger', path.join(directory, '05-freeze-primary/result.json')],
    ['chart', path.join(directory, 'report.html')],
    ...[
      'source.patch',
      'source-baseline.tar',
      'source-untracked.json',
      'source-jev-models.json',
    ].map((file) => ['source', path.join(directory, file)]),
  ] as Array<
    [StrategyResearchRetention['permanentArtifacts'][number]['role'], string]
  >) {
    try {
      permanentArtifacts.push({
        role,
        path: file,
        sha256: await sha256File(file),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const files = new Map<string, string>();
  for (const stage of Object.values(state.stages)) {
    for (const [relative, hash] of Object.entries(stage.artifacts)) {
      const file = await boundResearchPath(directory, relative);
      if (relative.endsWith('/result.json')) {
        const result = await readJson<Record<string, unknown>>(file);
        if (result?.dataset) files.set(file, hash);
      }
      if (
        relative.endsWith('/sources.json') ||
        relative.endsWith('/payloads.json')
      ) {
        const sources = await readJson<Record<string, string>>(file);
        for (const [source, sha] of Object.entries(sources)) {
          // Imported exports are absent from sources.json; retain any explicit
          // user inputs even if a native adapter happened to return that path.
          if (
            !spec.core.variants.some((variant) =>
              variant.files.includes(source),
            )
          )
            files.set(
              await fs.realpath(await boundResearchPath(projectRoot, source)),
              sha,
            );
        }
      }
    }
  }
  const entries: StrategyEvidenceRetentionEntry[] = [];
  for (const [file, hash] of files) {
    const stat = await fs.stat(file);
    entries.push({
      path: file,
      kind: 'research_payload',
      researchId: spec.core.researchId,
      sha256: hash,
      bytes: stat.size,
      createdAt: stat.birthtimeMs,
      verified: true,
      aggregated: true,
    });
  }
  return {
    research: {
      researchId: spec.core.researchId,
      status: 'completed',
      completedAt: Date.now(),
      permanentArtifacts,
    },
    entries,
  };
};

/** Reuse checksum-bound TradeJS retention, one recoverable receipt per file. */
const applyRetentionInventory = async (
  projectRoot: string,
  directory: string,
) => {
  const inventory = await readJson<Inventory>(
    path.join(directory, 'retention.json'),
  );
  const receipts = path.join(directory, 'retention');
  await fs.mkdir(receipts, { recursive: true });
  for (let index = 0; index < inventory.entries.length; index++) {
    const entry = inventory.entries[index];
    const receiptPath = path.join(receipts, `${index}.json`);
    let receipt: Receipt | undefined;
    try {
      receipt = await readJson<Receipt>(receiptPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (receipt) {
      const recorded = receipt.files[0];
      if (recorded?.path !== entry.path || recorded.sha256 !== entry.sha256)
        throw new Error(
          'Research retention receipt does not match the frozen inventory',
        );
      if (receipt.status === 'completed' && recorded.removed) continue;
      try {
        await fs.stat(entry.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // Recover the crash window between unlink and the final receipt write.
        if (receipt.status !== 'applying') throw error;
        await writeJsonAtomic(receiptPath, {
          ...receipt,
          status: 'completed',
          files: [{ ...recorded, removed: true }],
        });
        continue;
      }
      throw new Error(
        'Interrupted cleanup still owns an existing file; inspect its receipt before retrying',
      );
    }
    await applyResearchRetention({
      projectRoot,
      research: inventory.research,
      entries: [entry],
      receiptPath,
      apply: true,
      protectedPaths: [path.join(directory, 'retention.json')],
    });
  }
  return { status: 'completed', files: inventory.entries.length };
};

export const finishResearchRetention = async (
  projectRoot: string,
  directory: string,
) => {
  const statusPath = path.join(directory, 'retention-status.json');
  try {
    const result = await applyRetentionInventory(projectRoot, directory);
    await writeJsonAtomic(statusPath, result);
    return result;
  } catch (error) {
    await writeJsonAtomic(statusPath, {
      status: 'pending',
      reason: String(error),
    });
    throw error;
  }
};
