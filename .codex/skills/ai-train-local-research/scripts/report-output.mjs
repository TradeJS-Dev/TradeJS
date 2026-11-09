import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Keep the complete machine-readable result in one place. Explicit stdout-only
// callers still receive the full report; file-output callers receive a receipt.
export const writeResearchReport = async ({
  report,
  markdown,
  json = false,
  outputPath,
  stdout = process.stdout,
}) => {
  if (!outputPath) {
    stdout.write(json ? `${JSON.stringify(report)}\n` : markdown);
    return;
  }
  const resolvedPath = path.resolve(outputPath);
  const content = resolvedPath.endsWith('.json')
    ? `${JSON.stringify(report)}\n`
    : markdown;
  if (typeof content !== 'string') throw new Error('Missing report content');
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, 'utf8');
  const receipt = {
    schema: 'tradejs-research-report-receipt/v1',
    path: resolvedPath,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  };
  stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
};
