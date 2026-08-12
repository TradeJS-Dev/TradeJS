import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import {
  loadCoreResearchSpec,
  prepareCoreResearch,
  verifyCoreResearchArtifacts,
  writeCoreResearchStageIndex,
  writeJsonAtomic,
} from '../lib/coreResearch/io';
import {
  analyzeCoreResearch,
  createCoreResearchSpecTemplate,
  runCoreResearch,
} from '../lib/coreResearch/orchestrator';

type Command = 'init' | 'prepare' | 'analyze' | 'run' | 'verify' | 'index';

const valueAfter = (argv: string[], name: string) => {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
};

const required = (value: string | undefined, name: string) => {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
};

const parseTimestamp = (value: string | undefined, name: string) => {
  const text = required(value, name);
  const numeric = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  if (!Number.isFinite(numeric)) throw new Error(`${name} is invalid: ${text}`);
  return numeric;
};

const readSymbols = async (argv: string[]) => {
  const symbolsFile = valueAfter(argv, '--symbolsFile');
  if (symbolsFile) {
    const parsed = JSON.parse(
      await fs.readFile(path.resolve(symbolsFile), 'utf8'),
    ) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some((symbol) => typeof symbol !== 'string')
    ) {
      throw new Error('--symbolsFile must contain a JSON string array');
    }
    return parsed;
  }
  return required(valueAfter(argv, '--symbols'), '--symbols')
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean);
};

const printUsage = () => {
  console.log(`Usage:
  yarn research:core init --out <spec.json> --researchId <id> --strategy <name> --start <ts> --end <ts> (--symbols <csv> | --symbolsFile <json>)
  yarn research:core prepare --spec <spec.json>
  yarn research:core analyze --spec <spec.json>
  yarn research:core run --spec <spec.json>
  yarn research:core verify --spec <spec.json>
  yarn research:core index --root <data/research/core>

The run command executes only variants with an explicit command[] in the preregistered spec. Variants with files[] are analyzed without starting a backtest.`);
};

export const main = async () => {
  const argv = process.argv.slice(2);
  const command = argv[0] as Command | undefined;
  if (
    !command ||
    !['init', 'prepare', 'analyze', 'run', 'verify', 'index'].includes(command)
  ) {
    printUsage();
    if (command) process.exitCode = 1;
    return;
  }
  if (command === 'index') {
    const rootDir = path.resolve(
      required(valueAfter(argv, '--root'), '--root'),
    );
    const index = await writeCoreResearchStageIndex(rootDir);
    console.log(
      chalk.green(
        `Core research index: ${path.join(rootDir, 'index.json')} (${index.families.length} families)`,
      ),
    );
    return;
  }
  if (command === 'init') {
    const outputPath = path.resolve(
      required(valueAfter(argv, '--out'), '--out'),
    );
    const spec = createCoreResearchSpecTemplate({
      researchId: required(valueAfter(argv, '--researchId'), '--researchId'),
      strategy: required(valueAfter(argv, '--strategy'), '--strategy'),
      symbols: await readSymbols(argv),
      start: parseTimestamp(valueAfter(argv, '--start'), '--start'),
      end: parseTimestamp(valueAfter(argv, '--end'), '--end'),
      outputPath,
    });
    const { outputPath: _outputPath, ...persisted } = spec;
    await writeJsonAtomic(outputPath, persisted);
    console.log(chalk.green(`Core research spec created: ${outputPath}`));
    console.log(
      chalk.yellow(
        'Draft only: fill each variants[].resolvedConfig and configSha256 before prepare/analyze/run.',
      ),
    );
    return;
  }
  const specPath = required(valueAfter(argv, '--spec'), '--spec');
  const loaded = await loadCoreResearchSpec(specPath);
  if (command === 'prepare') {
    const result = await prepareCoreResearch(loaded.spec);
    console.log(
      chalk.green(
        `Prepared ${loaded.spec.researchId}: ${result.paths.researchDir}`,
      ),
    );
    return;
  }
  if (command === 'analyze') {
    const analyzed = await analyzeCoreResearch(loaded.spec);
    console.log(
      chalk.green(`Core research report: ${analyzed.paths.reportPath}`),
    );
    return;
  }
  if (command === 'run') {
    const analyzed = await runCoreResearch({ spec: loaded.spec });
    console.log(
      chalk.green(`Core research report: ${analyzed.paths.reportPath}`),
    );
    return;
  }
  const verified = await verifyCoreResearchArtifacts(loaded.spec);
  console.log(chalk.green(JSON.stringify(verified, null, 2)));
};
