import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createStrategyResearchSpec,
  validateStrategyResearchSpec,
  createNativeStrategyResearchBackend,
  runStrategyResearch,
  type StrategyResearchSpec,
  type ResearchState,
} from '../lib/strategyResearch';
import {
  resolveRequiredResearchRoots,
  resolveResearchRoots,
} from '../lib/researchRoots';
import { loadCoreResearchSpec, sha256Json } from '../lib/coreResearch/io';
import { createCoreResearchSpecTemplate } from '../lib/coreResearch/orchestrator';
import { getData, redisKeys } from '@tradejs/infra/redis';
import {
  boundResearchPath,
  readJson,
  researchDirectory,
  verifyCompletedResearch,
} from '../lib/strategyResearch/io';

const usage = `Usage:
  tradejs research:strategy init --coreSpec <core-spec.json> --out <workflow.json>
  tradejs research:strategy init --strategy <name> --config <Strategy:config> [--candidates <Strategy:a,Strategy:b>] --researchId <id> --claim <hypothesis> --mechanism <reason> --symbolsFile <USDT.json> --start <UTC> --end <UTC> --out <workflow.json>
  tradejs research:strategy run --spec <workflow.json>
  tradejs research:strategy status --spec <workflow.json>
  tradejs research:strategy verify --spec <workflow.json>
  tradejs research:strategy revalidate --spec <completed-workflow.json> --researchId <new-id> --start <UTC> --end <UTC> --out <new-workflow.json>

Run uses cached USDT history, bounded native backtests, mature-DEV gate search,
frozen rules, actual gated entries, non-fast and delayed-entry confirmation.
Resume with the same run command. No notifications, publication or live orders.
Revalidate keeps the frozen rule and evaluates a new period without fitting.
`;

export const main = async () => {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (!command || command === '--help') {
    console.log(usage);
    return;
  }
  if (!['init', 'run', 'status', 'verify', 'revalidate'].includes(command))
    throw new Error(usage);
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index],
      value = argv[index + 1];
    if (
      ![
        '--spec',
        '--strategy',
        '--config',
        '--candidates',
        '--claim',
        '--mechanism',
        '--symbolsFile',
        '--coreSpec',
        '--out',
        '--researchId',
        '--start',
        '--end',
      ].includes(key) ||
      !value ||
      value.startsWith('--') ||
      flags[key]
    )
      throw new Error(`Unknown, repeated or incomplete option: ${key}`);
    flags[key] = value;
  }
  const required = (key: string) => {
    if (!flags[key]) throw new Error(`${key} is required`);
    return flags[key];
  };
  const { projectRoot } = resolveResearchRoots();
  process.chdir(projectRoot);
  const resolve = (key: string) =>
    boundResearchPath(projectRoot, required(key));
  if (command === 'init') {
    const output = await resolve('--out');
    await fs.mkdir(path.dirname(output), { recursive: true });
    const timestamp = (key: string) => {
      const text = required(key);
      const value = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
      if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${key}`);
      return value;
    };
    const loaded = flags['--coreSpec']
      ? await loadCoreResearchSpec(await resolve('--coreSpec'))
      : await (async () => {
          const roots = resolveRequiredResearchRoots({ projectRoot });
          const strategy = required('--strategy');
          const symbols = await readJson<unknown>(
            await resolve('--symbolsFile'),
          );
          if (
            !Array.isArray(symbols) ||
            symbols.some((symbol) => typeof symbol !== 'string')
          )
            throw new Error('--symbolsFile must contain a string array');
          const template = createCoreResearchSpecTemplate({
            researchId: required('--researchId'),
            strategy,
            symbols,
            start: timestamp('--start'),
            end: timestamp('--end'),
            outputPath: output,
            projectRoot,
            sourceRepositoryRoot: roots.sourceRepositoryRoot,
          });
          const names = [
            required('--config'),
            ...(flags['--candidates'] ?? '').split(',').filter(Boolean),
          ];
          const variants = await Promise.all(
            names.map(async (configName, index) => {
              if (!configName.startsWith(`${strategy}:`))
                throw new Error(
                  'Every config must belong to the selected strategy',
                );
              const grid: unknown = await getData(
                redisKeys.backtestConfig('root', configName),
                null,
              );
              if (
                !grid ||
                typeof grid !== 'object' ||
                Array.isArray(grid) ||
                !Object.keys(grid).length
              )
                throw new Error(`Backtest config not found: ${configName}`);
              const entries = Object.entries(grid);
              if (
                entries.some(
                  ([, value]) => !Array.isArray(value) || value.length !== 1,
                )
              )
                throw new Error(
                  `Config ${configName} must be one resolved cell; supply bounded candidate configs separately`,
                );
              const resolvedConfig = Object.fromEntries(
                entries.map(([key, value]) => [key, (value as unknown[])[0]]),
              );
              return {
                id: index ? `candidate-${index}` : 'control',
                label: configName,
                role: index ? ('candidate' as const) : ('control' as const),
                configName,
                resolvedConfig,
                configSha256: sha256Json(resolvedConfig),
                files: [],
              };
            }),
          );
          return {
            spec: {
              ...template,
              variants,
              hypothesis: {
                ...template.hypothesis,
                claim: required('--claim'),
                mechanism: required('--mechanism'),
              },
            },
          };
        })();
    const spec = validateStrategyResearchSpec(
      createStrategyResearchSpec(loaded.spec),
    );
    await fs.writeFile(output, `${JSON.stringify(spec, null, 2)}\n`, {
      flag: 'wx',
    });
    console.log(
      `Условия сохранены: ${output}. Проверьте гипотезу, границу TEST и бюджет, затем выполните run.`,
    );
    return;
  }
  const spec = validateStrategyResearchSpec(
    await readJson<unknown>(await resolve('--spec')),
  );
  const directory = researchDirectory(projectRoot, spec);
  if (command === 'status') {
    const state = await readJson<ResearchState>(
      path.join(directory, 'state.json'),
    );
    console.log(
      JSON.stringify(
        {
          status: state.status,
          stages: state.stages,
          error: state.error,
          report: path.join(directory, 'report.html'),
          retention: await readJson(
            path.join(directory, 'retention-status.json'),
          ).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return { status: 'not-started' };
            throw error;
          }),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'verify' || command === 'revalidate') {
    const state = await readJson<ResearchState>(
      path.join(directory, 'state.json'),
    );
    await verifyCompletedResearch(directory, state);
    if (command === 'verify') {
      console.log(`Проверено: ${directory}`);
      return;
    }
    if (state.status !== 'completed')
      throw new Error('Only a completed research lineage can be revalidated');
    const timestamp = (key: string) => {
      const text = required(key);
      const value = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
      if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${key}`);
      return value;
    };
    const start = timestamp('--start'),
      end = timestamp('--end');
    const next = validateStrategyResearchSpec({
      ...spec,
      history: 'unopened',
      frozenFrom: spec.core.researchId,
      priorResearchIds: [],
      testSince: start,
      core: {
        ...spec.core,
        researchId: required('--researchId'),
        createdAt: new Date().toISOString(),
        window: { ...spec.core.window, start, end },
        variants: spec.core.variants.map((variant) => ({
          ...variant,
          files: [],
          runId: undefined,
        })),
      },
    });
    const output = await resolve('--out');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(next, null, 2)}\n`, {
      flag: 'wx',
    });
    console.log(`Замороженная проверка нового периода: ${output}`);
    return;
  }
  const roots = resolveRequiredResearchRoots({ projectRoot });
  await runStrategyResearch({
    spec,
    projectRoot,
    backend: createNativeStrategyResearchBackend(roots),
    onProgress: console.log,
  });
};
