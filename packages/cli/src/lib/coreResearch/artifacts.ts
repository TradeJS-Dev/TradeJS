import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './io';
import type { CoreResearchComparison, CoreResearchTrade } from './types';

const csv = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const writeLine = async (
  output: ReturnType<typeof createWriteStream>,
  line: string,
) => {
  if (!output.write(line)) await once(output, 'drain');
};

const closeOutput = async (output: ReturnType<typeof createWriteStream>) => {
  output.end();
  await once(output, 'close');
};

export const writeCoreResearchMatches = async (params: {
  filePath: string;
  comparisons: CoreResearchComparison[];
}) => {
  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  const output = createWriteStream(params.filePath, { encoding: 'utf8' });
  await writeLine(
    output,
    [
      'controlId',
      'candidateId',
      'identity',
      'symbol',
      'direction',
      'controlSignalTimestamp',
      'candidateSignalTimestamp',
      'controlPnl',
      'candidatePnl',
      'pnlDelta',
      'exitReasonChanged',
    ]
      .map(csv)
      .join(',') + '\n',
  );
  for (const comparison of params.comparisons) {
    for (const pair of comparison.matchedPairs) {
      await writeLine(
        output,
        [
          comparison.controlId,
          comparison.candidateId,
          pair.identity,
          pair.control.symbol,
          pair.control.direction,
          pair.control.signalTimestamp,
          pair.candidate.signalTimestamp,
          pair.control.netProfit,
          pair.candidate.netProfit,
          pair.pnlDelta,
          pair.exitReasonChanged,
        ]
          .map(csv)
          .join(',') + '\n',
      );
    }
  }
  await closeOutput(output);
};

export const writeCoreResearchTrades = async (params: {
  filePath: string;
  variants: Array<{ variantId: string; trades: CoreResearchTrade[] }>;
}) => {
  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  const output = createWriteStream(params.filePath, { encoding: 'utf8' });
  for (const variant of params.variants) {
    for (const trade of variant.trades) {
      await writeLine(
        output,
        `${canonicalJson({ variantId: variant.variantId, ...trade })}\n`,
      );
    }
  }
  await closeOutput(output);
};
