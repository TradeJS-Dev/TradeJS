import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  writeCoreResearchMatches,
  writeCoreResearchTrades,
} from '../artifacts';
import { compareCoreResearchVariants } from '../comparison';
import { makeSpec, makeTrade, makeVariant } from '../__fixtures__/fixtures';

describe('core research artifacts', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'core-artifacts-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('writes exit codes to normalized trades and matched comparisons', async () => {
    const control = makeTrade({ exitCode: 'CONTROL_EXIT' });
    const candidate = makeTrade({ exitCode: 'CANDIDATE_EXIT' });
    const comparison = compareCoreResearchVariants({
      spec: makeSpec(),
      control: {
        variant: makeVariant({ id: 'control', role: 'control' }),
        trades: [control],
      },
      candidate: {
        variant: makeVariant({ id: 'candidate', role: 'candidate' }),
        trades: [candidate],
      },
    });
    const matchesPath = path.join(tempRoot, 'matches.csv');
    const tradesPath = path.join(tempRoot, 'trades.jsonl');

    await writeCoreResearchMatches({
      filePath: matchesPath,
      comparisons: [comparison],
    });
    await writeCoreResearchTrades({
      filePath: tradesPath,
      variants: [
        { variantId: 'control', trades: [control] },
        { variantId: 'candidate', trades: [candidate] },
      ],
    });

    const matches = await fs.readFile(matchesPath, 'utf8');
    expect(matches).toContain(
      'controlExitCode,candidateExitCode,exitCodeChanged',
    );
    expect(matches).toContain('CONTROL_EXIT,CANDIDATE_EXIT,true');
    const trades = (await fs.readFile(tradesPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(trades.map((trade) => trade.exitCode)).toEqual([
      'CONTROL_EXIT',
      'CANDIDATE_EXIT',
    ]);
  });
});
