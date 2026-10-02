import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AiDatasetRow, JevRecord, JevStudyRow } from '@tradejs/types';
import { readJevArtifact, jevFileHash } from '@tradejs/infra/jev';
import {
  evaluateJevInput,
  trainJevGate,
  compareJevGate,
  validateJevGateModel,
} from '@tradejs/node/jev';

export const readJevJsonl = async <T>(file: string): Promise<T[]> => {
  const rows: T[] = [];
  const stream = createReadStream(file);
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      if (rows.length >= 20_000)
        throw new Error('Select at most 20000 rows for this bounded Jev study');
      rows.push(JSON.parse(line));
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return rows;
};

const writeNew = async (file: string, contents: string) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents, { flag: 'wx', mode: 0o600 });
};

export const runJevResearch = async (options: {
  action: string;
  projectRoot: string;
  userName: string;
  input?: string;
  out: string;
  strategy?: string;
  recordsDir: string;
  model?: string;
  maxDepth?: number;
  minLeaf?: number;
}) => {
  const resolve = (file: string) => path.resolve(options.projectRoot, file);
  const out = resolve(options.out);
  // Refuse overwriting an earlier experiment before doing any paid work.
  try {
    await fs.access(out);
    throw new Error('Jev output already exists; choose a new output path');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (options.action === 'evaluate') {
    if (!options.input)
      throw new Error('Provide an AI dataset JSONL with --input');
    const rows = await readJevJsonl<AiDatasetRow>(resolve(options.input));
    const selected = rows.filter(
      (row) => !options.strategy || row.strategyName === options.strategy,
    );
    if (!selected.length) throw new Error('No matching Jev input rows');
    for (const row of selected) {
      if (!row.assessment?.recordId)
        throw new Error(
          `Signal ${row.signalId} has no Jev recording. Run the backtest with --ai --jev and use its --jevRecordsDir; an --ai-only export cannot restore the signal-time Jev facts.`,
        );
      if (!/^[a-f0-9]{64}$/.test(row.assessment.recordId))
        throw new Error(`Invalid Jev recording id for signal ${row.signalId}`);
    }
    await fs.mkdir(path.dirname(out), { recursive: true });
    const temp = `${out}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      try {
        for (const row of selected) {
          const recordId = row.assessment!.recordId!;
          const saved = await readJevArtifact<JevRecord>(
            resolve(
              path.join(options.recordsDir, 'records', `${recordId}.json`),
            ),
          );
          if (!saved)
            throw new Error(
              `Jev recording ${recordId} for signal ${row.signalId} is missing from --jevRecordsDir. Use the recordings from the original --ai --jev backtest.`,
            );
          if (saved.schema !== 'tradejs-jev-record/v4')
            throw new Error(
              `Jev recording ${recordId} uses an older schema; rerun the backtest with the current --jev integration.`,
            );
          if (
            saved.id !== recordId ||
            saved.inputHash !== row.assessment?.inputHash ||
            saved.questionsHash !== row.assessment?.questionsHash
          )
            throw new Error(
              `Jev recording ${recordId} does not match signal ${row.signalId}`,
            );
          const { record } = await evaluateJevInput({
            input: saved.input,
            config: {
              source: 'recorded',
              mode: 'observe',
              provider: saved.provider,
              recordsDir: options.recordsDir,
            },
            userName: options.userName,
            projectRoot: options.projectRoot,
          });
          if (!record)
            throw new Error(
              `No eligible Jev questions for signal ${row.signalId}`,
            );
          const study: JevStudyRow = {
            schema: 'tradejs-jev-study/v4',
            signalId: row.signalId,
            record,
            ...(Number.isFinite(row.profit) ? { profit: row.profit } : {}),
          };
          await handle.write(`${JSON.stringify(study)}\n`);
        }
      } finally {
        await handle.close();
      }
      await fs.link(temp, out);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return { rows: selected.length, out };
  }
  if (options.action === 'export') {
    const dir = resolve(path.join(options.recordsDir, 'records'));
    const rows: JevStudyRow[] = [];
    const outcomes = options.input
      ? await readJevJsonl<AiDatasetRow>(resolve(options.input))
      : [];
    const byRecord = new Map<string, AiDatasetRow>();
    for (const row of outcomes) {
      const id = row.assessment?.recordId;
      if (!id) continue;
      if (!/^[a-f0-9]{64}$/.test(id))
        throw new Error('Invalid Jev recording id');
      const prior = byRecord.get(id);
      if (
        prior &&
        (prior.profit !== row.profit || prior.signalId !== row.signalId)
      )
        throw new Error('Conflicting outcomes for one Jev recording');
      byRecord.set(id, row);
    }
    for (const file of (await fs.readdir(dir))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .sort()) {
      const record = await readJevArtifact<JevRecord>(path.join(dir, file));
      if (
        !record ||
        (options.strategy && record.input.strategy !== options.strategy)
      )
        continue;
      if (rows.length >= 20_000)
        throw new Error(
          'Export exceeds 20000 samples; select a bounded recording directory',
        );
      // Export only recordings accepted by the current evaluator, never old rubrics.
      await evaluateJevInput({
        input: record.input,
        config: {
          source: 'recorded',
          mode: 'observe',
          provider: record.provider,
          recordsDir: options.recordsDir,
        },
        userName: options.userName,
        projectRoot: options.projectRoot,
      });
      const outcome = byRecord.get(record.id);
      rows.push({
        schema: 'tradejs-jev-study/v4',
        signalId: outcome?.signalId ?? record.id,
        record,
        ...(outcome && Number.isFinite(outcome.profit)
          ? { profit: outcome.profit }
          : {}),
      });
    }
    if (!rows.length) throw new Error('No Jev recordings to export');
    await writeNew(
      out,
      rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    );
    return { rows: rows.length, out };
  }
  if (!options.input) throw new Error('Provide a Jev study JSONL with --input');
  const rows = await readJevJsonl<JevStudyRow>(resolve(options.input));
  if (options.action === 'train') {
    const { model, report } = trainJevGate(rows, options);
    const contents = `${JSON.stringify(model, null, 2)}\n`;
    await writeNew(
      `${out}.report.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await writeNew(out, contents);
    return {
      model: out,
      modelSha256: jevFileHash(contents),
      report: `${out}.report.json`,
      trainEnd: model.training.trainEnd,
      validationEnd: model.training.validationEnd,
    };
  }
  if (options.action === 'compare') {
    if (!options.model) throw new Error('Provide --model');
    const model = validateJevGateModel(
      JSON.parse(await fs.readFile(resolve(options.model), 'utf8')),
    );
    const heldOut = rows.filter(
      (row) => row.record.input.timestamp > model.training.validationEnd,
    );
    if (!heldOut.length)
      throw new Error('No held-out rows after model validationEnd');
    const report = compareJevGate(model, heldOut);
    await writeNew(out, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }
  throw new Error('Jev action must be evaluate, export, train, or compare');
};
