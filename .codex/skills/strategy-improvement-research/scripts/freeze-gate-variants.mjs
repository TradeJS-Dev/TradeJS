#!/usr/bin/env node

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `Usage:
  node freeze-gate-variants.mjs --pocket <report.json> --candidateId <id> --output <spec.json> [--limit <1..5>]
`;

const parseArgs = (argv) => {
  const options = { limit: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const name = argument.slice(2);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    if (name === 'limit') options.limit = Number(value);
    else if (['pocket', 'candidateId', 'output'].includes(name)) options[name] = value;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!options.pocket || !options.candidateId || !options.output) {
    throw new Error('Required: --pocket, --candidateId, and --output');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 5) {
    throw new Error('--limit must be an integer from 1 through 5');
  }
  return options;
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const buildFrozenGateSpec = ({ report, candidateId, limit, sourcePath, sourceSha256 }) => {
  if (report?.run?.featurePolicy !== 'causal-stationary') {
    throw new Error('Pocket report must use featurePolicy=causal-stationary');
  }
  const pockets = report?.pocketSearch?.positivePockets;
  if (!Array.isArray(pockets) || pockets.length === 0) {
    throw new Error('Pocket report has no positive pockets to freeze');
  }
  const variants = pockets.slice(0, limit).map((pocket, index) => {
    const predicates = pocket?.predicates;
    if (!Array.isArray(predicates) || predicates.length === 0) {
      throw new Error(`Pocket ${index + 1} has no predicates`);
    }
    return {
      name: `${candidateId}-own-gate-${index + 1}`,
      mode: 'replace',
      quality: 4,
      expression: predicates.map((predicate) => predicate.label).join(' && '),
      discovery: {
        rank: index + 1,
        support: pocket.summary?.support ?? null,
        events: pocket.summary?.events ?? null,
      },
    };
  });
  return {
    schema: 'tradejs-candidate-gate-variants/v1',
    candidateId,
    sourcePocketReport: { path: sourcePath, sha256: sourceSha256 },
    discovery: {
      featurePolicy: report.run.featurePolicy,
      until: report.run.until,
      trainRows: report.run.trainRows,
      validationRows: report.run.validationRows,
      testRows: report.run.testRows,
    },
    variants,
  };
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const pocketPath = path.resolve(options.pocket);
  const outputPath = path.resolve(options.output);
  const pocketText = await fsp.readFile(pocketPath, 'utf8');
  const spec = buildFrozenGateSpec({
    report: JSON.parse(pocketText),
    candidateId: options.candidateId,
    limit: options.limit,
    sourcePath: options.pocket,
    sourceSha256: sha256(pocketText),
  });
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const output = `${JSON.stringify(spec, null, 2)}\n`;
  await fsp.writeFile(outputPath, output, 'utf8');
  process.stdout.write(`${sha256(output)}  ${options.output}\n`);
};

if (pathToFileURL(path.resolve(process.argv[1] ?? '')).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
