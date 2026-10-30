import fs from 'node:fs/promises';
import path from 'node:path';
import type { ResearchEntryPolicy } from '@tradejs/types';
import { summarizeCoreResearchWindow } from '../coreResearch/metrics';
import { sha256File, sha256Json, writeJsonAtomic } from '../coreResearch/io';
import type { CoreResearchVariant } from '../coreResearch/types';
import { validateStrategyResearchSpec, policyVariant } from './specification';
import {
  boundResearchPath,
  initializeResearchState,
  readJson,
  researchDirectory,
  withResearchLock,
} from './io';
import { discoverResearchGate } from './gates';
import { selectResearchDirections } from './directions';
import { freezeJevResearchPair, compareJevResearch } from './jevComparison';
import {
  buildResearchDiagnostics,
  type ResearchDiagnostics,
} from './diagnostics';
import {
  chooseDevelopmentPrimary,
  equivalentResearchExecutions,
  evaluateResearchComposition,
  researchTerminalWindows,
} from './evaluation';
import { buildStrategyResearchReport } from './report';
import {
  createResearchRetentionInventory,
  finishResearchRetention,
} from './retention';
import type {
  FrozenResearchGate,
  FrozenResearchSelection,
  ResearchComposition,
  ResearchConclusion,
  ResearchDataset,
  ResearchEvaluation,
  StrategyResearchBackend,
  StrategyResearchSpec,
} from './types';

export const runStrategyResearch = async (parameters: {
  spec: StrategyResearchSpec;
  projectRoot: string;
  backend: StrategyResearchBackend;
  onProgress?: (message: string) => void;
}) => {
  let spec = validateStrategyResearchSpec(parameters.spec);
  const { backend } = parameters;
  const projectRoot = await fs.realpath(parameters.projectRoot);
  await boundResearchPath(
    projectRoot,
    `data/research/strategy/${spec.core.researchId}`,
  );
  return withResearchLock(projectRoot, async () => {
    const directory = researchDirectory(projectRoot, spec);
    const lineage = await backend.lineage();
    const state = await initializeResearchState(directory, spec, lineage);
    const statePath = path.join(directory, 'state.json');
    const elapsedBefore = state.elapsedMs ?? 0;
    const activeStart = Date.now();
    const elapsed = () => elapsedBefore + Date.now() - activeStart;
    if (state.status === 'completed') {
      await finishResearchRetention(projectRoot, directory);
      return {
        directory,
        state,
        conclusion: await readJson<ResearchConclusion>(
          path.join(directory, 'result.json'),
        ),
      };
    }
    const diagnostics: Array<{
      id: string;
      summary: ResearchDiagnostics;
      samples: ResearchDataset['samples'];
    }> = [];
    const save = () => {
      state.elapsedMs = elapsed();
      return writeJsonAtomic(statePath, state);
    };
    const event = async (stage: string, status: string) =>
      fs.appendFile(
        path.join(directory, 'events.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), stage, status, specSha256: state.specSha256 })}\n`,
      );
    const stage = async <T>(
      name: string,
      work: (stageDirectory: string) => Promise<T>,
    ): Promise<T> => {
      const stageDirectory = await boundResearchPath(directory, name);
      const resultPath = path.join(stageDirectory, 'result.json');
      if (state.stages[name]?.status === 'completed')
        return readJson<T>(resultPath);
      if (elapsed() > spec.budget.maxMinutes * 60_000)
        throw new Error(
          'Research wall-time budget exhausted; do not silently increase the preregistered budget',
        );
      parameters.onProgress?.(`${name}: выполняется`);
      state.stages[name] = {
        status: 'running',
        startedAt: new Date().toISOString(),
        artifacts: {},
      };
      state.status = 'running';
      delete state.error;
      await fs.mkdir(stageDirectory, { recursive: true });
      await save();
      await event(name, 'started');
      await fs.writeFile(
        path.join(directory, 'report.html'),
        buildStrategyResearchReport({ spec, state, diagnostics }),
      );
      try {
        const result = await work(stageDirectory);
        await writeJsonAtomic(resultPath, result);
        const artifacts: Record<string, string> = {};
        for (const file of await fs.readdir(stageDirectory)) {
          const full = path.join(stageDirectory, file);
          if ((await fs.stat(full)).isFile())
            artifacts[`${name}/${file}`] = await sha256File(full);
        }
        if (name === '01-preflight') {
          for (const file of [
            'source.patch',
            'source-baseline.tar',
            'source-untracked.json',
            'source-jev-models.json',
          ]) {
            try {
              artifacts[file] = await sha256File(path.join(directory, file));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
            }
          }
        }
        state.stages[name] = {
          ...state.stages[name],
          status: 'completed',
          finishedAt: new Date().toISOString(),
          artifacts,
        };
        await save();
        await event(name, 'completed');
        parameters.onProgress?.(`${name}: завершён`);
        return result;
      } catch (error) {
        state.stages[name] = {
          ...state.stages[name],
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: String(error instanceof Error ? error.message : error),
        };
        await save();
        await event(name, 'failed');
        throw error;
      }
    };
    const run = async (
      scope: StrategyResearchSpec,
      variant: CoreResearchVariant,
      name: string,
      confirmation = false,
      discoveryOnly = false,
    ) =>
      stage(name, async (folder) => {
        let previousRunId: string | undefined;
        try {
          previousRunId = (
            await readJson<{ runId: string }>(
              path.join(folder, 'native-run.json'),
            )
          ).runId;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (!previousRunId) {
          try {
            if ((await fs.stat(path.join(folder, 'backtest.log'))).size)
              throw new Error(
                'Previous native attempt has no recorded run identity; inspect its log before another launch',
              );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        const resolved = await backend.runVariant(
          {
            ...scope,
            budget: {
              ...scope.budget,
              maxMinutes: Math.max(
                0.001,
                (spec.budget.maxMinutes * 60_000 - elapsed()) / 60_000,
              ),
            },
          },
          variant,
          folder,
          async (runId) =>
            writeJsonAtomic(path.join(folder, 'native-run.json'), { runId }),
          previousRunId,
          confirmation,
        );
        const dataset = await backend.loadDataset(
          scope,
          resolved,
          folder,
          discoveryOnly,
        );
        return { variant: resolved, dataset };
      });
    try {
      const inventory = await stage('01-preflight', async () => {
        const prior: Array<{ id: string; exposed: boolean }> = [];
        const root = path.dirname(directory);
        for (const id of await fs.readdir(root)) {
          if (id === spec.core.researchId || id.startsWith('.')) continue;
          try {
            const previous = await readJson<StrategyResearchSpec>(
              path.join(root, id, 'spec.json'),
            );
            const previousState = await readJson<{ holdoutOpenedAt?: string }>(
              path.join(root, id, 'state.json'),
            );
            const overlap =
              previous.core.strategy === spec.core.strategy &&
              previous.core.window.start < spec.core.window.end &&
              previous.core.window.end >
                (spec.testSince || spec.core.window.start);
            if (overlap && previousState.holdoutOpenedAt)
              prior.push({ id, exposed: true });
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
              !(error instanceof SyntaxError)
            )
              throw error;
          }
        }
        for (const id of spec.priorResearchIds)
          if (!prior.some((item) => item.id === id))
            prior.push({ id, exposed: true });
        return { prior, checks: await backend.preflight(spec) };
      });
      let partitionControl: CoreResearchVariant | undefined;
      if (spec.testSince === 0) {
        const control = spec.core.variants.find(
          (variant) => variant.role === 'control',
        )!;
        partitionControl = await stage(
          '01-partition-control',
          async (folder) => {
            let previous: string | undefined;
            try {
              previous = (
                await readJson<{ runId: string }>(
                  path.join(folder, 'native-run.json'),
                )
              ).runId;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
            }
            return backend.runVariant(
              spec,
              control,
              folder,
              async (runId) =>
                writeJsonAtomic(path.join(folder, 'native-run.json'), {
                  runId,
                }),
              previous,
            );
          },
        );
        const resolved = partitionControl;
        const partition = await stage('01-partition', () =>
          backend.selectPartition(spec, resolved),
        );
        spec = { ...spec, testSince: partition.testSince };
      }
      await writeJsonAtomic(path.join(directory, 'resolved-spec.json'), spec);
      let gates: FrozenResearchGate[] = [];
      let primaryId: string | null = null;
      let frozenSelection: FrozenResearchSelection;
      const raw: Record<
        string,
        ReturnType<typeof summarizeCoreResearchWindow>
      > = {};
      const discovered: FrozenResearchGate[] = [];
      const control = spec.core.variants.find(
        (variant) => variant.role === 'control',
      )!;
      const currentPolicy: ResearchEntryPolicy = {
        schema: 'tradejs-research-entry-policy/v1',
        strategy: spec.core.strategy,
        mode: 'current-gate',
        minQuality: spec.minQuality,
        rules: { LONG: null, SHORT: null },
      };
      const compositionBoard = (): ResearchComposition[] => {
        const current = spec.core.variants.flatMap<ResearchComposition>(
          (variant) => {
            const id =
              variant.role === 'control' ? 'baseline' : `current-${variant.id}`;
            const base: ResearchComposition = {
              id,
              coreId: variant.id,
              policy: currentPolicy,
              role: variant.role === 'control' ? 'baseline' : 'candidate',
              ...(variant.resolvedConfig.JEV
                ? ({
                    jev: 'enabled',
                    jevPairId: `current-${variant.id}`,
                  } as const)
                : {}),
            };
            return variant.resolvedConfig.JEV
              ? [
                  base,
                  {
                    ...base,
                    id: `nojev-${id}`,
                    role: 'candidate',
                    jev: 'disabled',
                  },
                ]
              : [base];
          },
        );
        return [
          ...current,
          ...gates.map((gate) => ({
            id: `${gate.jev === 'disabled' ? 'nojev-' : ''}own-${gate.coreId}`,
            coreId: gate.coreId,
            policy: gate.policy,
            role: 'candidate' as const,
            jev: gate.jev,
            ...(gate.jev ? { jevPairId: `own-${gate.coreId}` } : {}),
          })),
        ];
      };
      if (spec.frozenFrom) {
        const parentDirectory = researchDirectory(projectRoot, {
          ...spec,
          core: { ...spec.core, researchId: spec.frozenFrom },
        });
        const parentState = await readJson<import('./types').ResearchState>(
          path.join(parentDirectory, 'state.json'),
        );
        const parentSpec = await readJson<StrategyResearchSpec>(
          path.join(parentDirectory, 'spec.json'),
        );
        const { verifyCompletedResearch } = await import('./io');
        await verifyCompletedResearch(parentDirectory, parentState);
        if (
          parentState.status !== 'completed' ||
          parentSpec.core.window.end > spec.core.window.start ||
          sha256Json([
            parentSpec.core.variants.map((item) => item.resolvedConfig),
            parentSpec.core.universe,
            parentSpec.core.execution,
            parentSpec.selection,
            parentSpec.portfolio,
            parentSpec.minQuality,
            parentSpec.diagnostics,
          ]) !==
            sha256Json([
              spec.core.variants.map((item) => item.resolvedConfig),
              spec.core.universe,
              spec.core.execution,
              spec.selection,
              spec.portfolio,
              spec.minQuality,
              spec.diagnostics,
            ]) ||
          parentState.lineage.runtimeSha256 !== state.lineage.runtimeSha256 ||
          parentState.lineage.contextEnvironmentSha256 !==
            state.lineage.contextEnvironmentSha256
        )
          throw new Error(
            'Frozen revalidation requires complete, unchanged rules/runtime and a strictly new period',
          );
        gates = await readJson<FrozenResearchGate[]>(
          path.join(parentDirectory, '03-freeze-gates/result.json'),
        );
        frozenSelection = await readJson<FrozenResearchSelection>(
          path.join(parentDirectory, '05-freeze-primary/result.json'),
        );
        if (
          frozenSelection.schema !== 'tradejs-research-selection/v1' ||
          !Array.isArray(frozenSelection.compositions)
        )
          throw new Error(
            'Parent lacks a frozen direction selection; start a new DEV lineage instead of selecting on the new period',
          );
        if (
          spec.core.variants.some((variant) => variant.resolvedConfig.JEV) &&
          frozenSelection.jevPair === undefined
        )
          throw new Error(
            'Parent lacks a frozen Jev pair; create a new DEV lineage',
          );
        primaryId = frozenSelection.primaryId;
        await stage('03-freeze-gates', async () => gates);
        await stage('05-freeze-primary', async () => frozenSelection);
      } else {
        // The complete core board is preregistered in spec.json. Raw execution
        // is followed only by mature-DEV analysis until every gate is frozen.
        for (const variant of spec.core.variants) {
          const result = await run(
            spec,
            variant.role === 'control' && partitionControl
              ? partitionControl
              : variant,
            `02-raw-${variant.id}`,
            false,
            true,
          );
          raw[variant.id] = summarizeCoreResearchWindow({
            trades: result.dataset.trades,
            label: 'DEV raw core',
            start: spec.core.window.start,
            end: spec.testSince,
          });
          discovered.push(
            await stage(`02-discovery-${variant.id}`, async () =>
              discoverResearchGate(
                spec,
                result.dataset,
                variant.resolvedConfig.JEV ? 'enabled' : undefined,
              ),
            ),
          );
          if (variant.resolvedConfig.JEV)
            discovered.push(
              await stage(`02-discovery-nojev-${variant.id}`, async () =>
                discoverResearchGate(spec, result.dataset, 'disabled'),
              ),
            );
          const summary = buildResearchDiagnostics(spec, result.dataset);
          diagnostics.push({
            id: variant.id,
            summary,
            samples: result.dataset.samples,
          });
          await stage(`02-diagnosis-${variant.id}`, async () => summary);
        }
        gates = await stage('03-freeze-gates', async () => discovered);
        const developmentSpec = {
          ...spec,
          core: {
            ...spec.core,
            window: { ...spec.core.window, end: spec.testSince },
          },
        };
        const screened: ReturnType<typeof selectResearchDirections>[] = [];
        const development: ResearchEvaluation[] = [];
        const compositions: ResearchComposition[] = [compositionBoard()[0]];
        for (const composition of compositionBoard()) {
          const executed = await run(
            developmentSpec,
            policyVariant(
              spec,
              composition.coreId,
              composition.policy,
              composition.id,
              composition.jev,
            ),
            `04-dev-${composition.id}`,
          );
          if (composition.role === 'baseline')
            development.push(
              evaluateResearchComposition({
                spec,
                dataset: executed.dataset,
                ...composition,
                development: true,
              }),
            );
          const selection = selectResearchDirections(
            spec,
            executed.dataset,
            composition,
          );
          screened.push(selection);
          if (selection.composition.id !== 'baseline') {
            compositions.push(selection.composition);
            development.push(selection.development);
          }
        }
        const directionSelections = await stage(
          '04-freeze-directions',
          async () => screened.map((item) => item.selection),
        );
        frozenSelection = await stage(
          '05-freeze-primary',
          async (): Promise<FrozenResearchSelection> => ({
            schema: 'tradejs-research-selection/v1',
            primaryId: chooseDevelopmentPrimary(development),
            compositions,
            directionSelections,
            development,
            jevPair: freezeJevResearchPair(
              compositions,
              development,
              chooseDevelopmentPrimary(development),
            ),
          }),
        );
        primaryId = frozenSelection.primaryId;
      }
      // This write precedes every full gated evaluation and survives failures.
      if (!state.holdoutOpenedAt) {
        state.holdoutOpenedAt = new Date().toISOString();
        await save();
        await event('holdout', 'opened-after-freeze');
      }
      const evaluations: ResearchEvaluation[] = [];
      const rawReports: Record<
        string,
        ReturnType<typeof summarizeCoreResearchWindow>[]
      > = {};
      for (const variant of spec.core.variants) {
        rawReports[variant.id] = await stage(
          `06-raw-metrics-${variant.id}`,
          async (folder) => {
            const resolved = spec.frozenFrom
              ? (await run(spec, variant, `06-raw-revalidation-${variant.id}`))
                  .variant
              : (
                  await readJson<{ variant: CoreResearchVariant }>(
                    path.join(directory, `02-raw-${variant.id}`, 'result.json'),
                  )
                ).variant;
            const dataset = await backend.loadDataset(
              spec,
              resolved,
              folder,
              false,
            );
            return [
              summarizeCoreResearchWindow({
                trades: dataset.trades,
                label: 'full raw core',
                start: spec.core.window.start,
                end: spec.core.window.end,
              }),
              ...researchTerminalWindows(
                dataset.trades,
                spec.core.window.start,
                spec.core.window.end,
              ),
            ];
          },
        );
      }
      const executedDatasets = new Map<string, ResearchDataset>();
      const testBoard = new Map(
        frozenSelection.compositions
          .filter(
            (composition) =>
              composition.role === 'baseline' || composition.id === primaryId,
          )
          .map((item) => [item.id, item]),
      );
      if (frozenSelection.jevPair)
        for (const arm of [
          frozenSelection.jevPair.withJev,
          frozenSelection.jevPair.withoutJev,
        ])
          testBoard.set(arm.id, arm);
      for (const composition of testBoard.values()) {
        const result = await run(
          spec,
          policyVariant(
            spec,
            composition.coreId,
            composition.policy,
            composition.id,
            composition.jev,
          ),
          `06-test-${composition.id}`,
        );
        executedDatasets.set(composition.id, result.dataset);
        evaluations.push(
          evaluateResearchComposition({
            spec,
            dataset: result.dataset,
            ...composition,
          }),
        );
      }
      const confirmation = await stage('07-confirmation', async () => {
        if (!primaryId)
          return {
            passed: false,
            reason:
              'No DEV-eligible primary; confirmation is not used to rescue another candidate',
          };
        const chosen = evaluations.find(
          (evaluation) => evaluation.id === primaryId,
        )!;
        if (!chosen.passed)
          return {
            passed: false,
            reason:
              'TEST criteria failed; expensive confirmation was skipped without substituting another candidate',
          };
        const variant = policyVariant(
          spec,
          chosen.coreId,
          chosen.policy,
          `${primaryId}-confirmation`,
          chosen.jev,
        );
        const result = await run(spec, variant, '07-nonfast', true);
        const original = executedDatasets.get(primaryId)!;
        if (!equivalentResearchExecutions(original, result.dataset))
          return {
            passed: false,
            reason: 'Fast/non-fast execution identities or economics differ',
          };
        const delayedSpec = {
          ...spec,
          core: {
            ...spec.core,
            execution: {
              ...spec.core.execution,
              entryDelayBars: (spec.core.execution.entryDelayBars ?? 1) + 1,
            },
          },
        };
        const delay = await run(
          delayedSpec,
          { ...variant, id: `${primaryId}-delay` },
          '07-delay-stress',
        );
        const evaluated = evaluateResearchComposition({
          spec: delayedSpec,
          dataset: delay.dataset,
          id: `${primaryId}-delay`,
          coreId: chosen.coreId,
          role: 'candidate',
          policy: chosen.policy,
        });
        return {
          passed: evaluated.passed,
          reason: evaluated.passed
            ? 'Native confirmation and extra-bar delay passed'
            : evaluated.reasons.join('; '),
          delay: evaluated,
        };
      });
      const jevComparison = await stage('07-jev-comparison', async () =>
        compareJevResearch(
          spec,
          frozenSelection.jevPair,
          evaluations,
          executedDatasets,
          frozenSelection.development,
          frozenSelection.compositions,
          spec.history === 'retrospective' ||
            inventory.prior.some((item) => item.exposed),
        ),
      );
      const conclusion = await stage(
        '08-conclusion',
        async (): Promise<ResearchConclusion> => {
          const primary = evaluations.find(
            (evaluation) => evaluation.id === primaryId,
          );
          const economicPass = primary?.passed && confirmation.passed;
          const exposed =
            spec.history === 'retrospective' ||
            inventory.prior.some((item) => item.exposed);
          const sparse = primary
            ? primary.testEvents < spec.selection.minimumEvents
            : Object.values(raw).every(
                (window) =>
                  window.cohorts.ALL.trades < spec.selection.minimumEvents,
              );
          const status =
            economicPass && !exposed
              ? 'candidate-confirmed'
              : sparse ||
                  Boolean(primary?.capacity.rejected) ||
                  (economicPass && exposed)
                ? 'insufficient-data'
                : 'rejected';
          const reasons = [
            ...(primary?.reasons ?? [
              'На DEV не найден кандидат, прошедший зафиксированные критерии',
            ]),
            ...(!confirmation.passed ? [confirmation.reason] : []),
            ...(exposed
              ? [
                  'История уже изучалась; требуется неизменная проверка на новом периоде',
                ]
              : []),
          ];
          return {
            status,
            selectedId: status === 'candidate-confirmed' ? primaryId : null,
            reasons: reasons.length
              ? reasons
              : [
                  'Независимый кандидат прошёл зафиксированные критерии в пределах указанного набора инструментов',
                ],
            nextAction:
              status === 'candidate-confirmed'
                ? 'Сохранить кандидата; отдельно проверить соответствие целевому runtime перед запросом на запуск.'
                : primaryId
                  ? 'Проверить замороженное правило на новом периоде через research:strategy revalidate.'
                  : 'Завершить эту семью гипотез; новая причинная идея получает новый researchId.',
            evaluations,
            directionSelections: frozenSelection.directionSelections,
            jevComparison,
            trials: {
              core: spec.core.variants.length,
              predicates: gates.reduce(
                (sum, gate) =>
                  sum +
                  gate.discovery.LONG.stats.predicates +
                  gate.discovery.SHORT.stats.predicates,
                0,
              ),
              combinations: gates.reduce(
                (sum, gate) =>
                  sum +
                  gate.discovery.LONG.stats.combinationsEvaluated +
                  gate.discovery.SHORT.stats.combinationsEvaluated,
                0,
              ),
              frozenGates: gates.length,
              directionScreens: frozenSelection.directionSelections.length,
            },
          };
        },
      );
      const executions: unknown[] = [];
      for (const name of Object.keys(state.stages)) {
        try {
          const result = await readJson<{ variant?: CoreResearchVariant }>(
            path.join(directory, name, 'result.json'),
          );
          if (result?.variant)
            executions.push({ stage: name, ...result.variant });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      await writeJsonAtomic(path.join(directory, 'result.json'), {
        ...conclusion,
        executions,
        rawCore: Object.entries(rawReports).map(([id, windows]) => ({
          id,
          development: raw[id],
          windows,
        })),
        lineage,
      });
      state.status = 'completed';
      delete state.error;
      await save();
      await fs.writeFile(
        path.join(directory, 'report.html'),
        buildStrategyResearchReport({
          spec,
          state,
          conclusion,
          diagnostics,
          rawReports,
        }),
      );
      const noteDirectory = await boundResearchPath(
        projectRoot,
        `notes/${spec.core.strategy}`,
      );
      await fs.mkdir(noteDirectory, { recursive: true });
      const compact = {
        ...conclusion,
        gates,
        executions,
        rawReports,
        diagnostics: diagnostics.map(({ id, summary }) => ({ id, summary })),
        evaluations: conclusion.evaluations.map(
          ({
            equity: _equity,
            testEquity: _testEquity,
            testDrawdown: _testDrawdown,
            directionEquity: _directionEquity,
            ...evaluation
          }) => evaluation,
        ),
      };
      const note = `---\nschema: tradejs-research/v1\nstrategy: '${spec.core.strategy}'\ndate: '${spec.core.createdAt.slice(0, 10)}'\nkind: 'backtest'\nstatus: research-only\nreproduction: complete\n---\n\n# ${spec.core.strategy} — ${spec.core.researchId}\n\n## Research question\n\n${spec.core.hypothesis.claim}\n\n## Decision\n\n${conclusion.status}: ${conclusion.reasons.join('; ')}\n\n## Reproduction manifest\n\n\`\`\`json\n${JSON.stringify(lineage, null, 2)}\n\`\`\`\n\n## Resolved configuration\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n## Metrics snapshot (machine-readable)\n\n\`\`\`json\n${JSON.stringify(compact, null, 2)}\n\`\`\`\n\n## Reported metrics\n\nALL/LONG/SHORT; PnL per completed trade; exit-ordered realized drawdown. See report.html.\n\n## Findings\n\n${conclusion.reasons.join('\n\n')}\n\n## Artifact inventory\n\n${directory}/report.html\n\n## Limitations and next step\n\n${conclusion.nextAction} Current-snapshot universe; no deployment authorization. Temporary payloads are deleted only after the permanent record is verified; new trade-level questions require a frozen rerun.\n`;
      await fs
        .writeFile(
          path.join(
            noteDirectory,
            `${spec.core.createdAt.slice(0, 10)}-${spec.core.researchId}.md`,
          ),
          note,
          { flag: 'wx' },
        )
        .catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
          const existing = await fs.readFile(
            path.join(
              noteDirectory,
              `${spec.core.createdAt.slice(0, 10)}-${spec.core.researchId}.md`,
            ),
            'utf8',
          );
          if (existing !== note)
            throw new Error(
              'Permanent research note differs from the frozen result',
            );
        });
      await writeJsonAtomic(
        path.join(directory, 'retention.json'),
        await createResearchRetentionInventory(
          projectRoot,
          directory,
          spec,
          state,
          path.join(
            noteDirectory,
            `${spec.core.createdAt.slice(0, 10)}-${spec.core.researchId}.md`,
          ),
        ),
      );
      await writeJsonAtomic(path.join(directory, 'manifest.json'), {
        schema: 'tradejs-strategy-research-manifest/v1',
        specSha256: state.specSha256,
        artifacts: Object.fromEntries(
          await Promise.all(
            [
              'spec.json',
              'resolved-spec.json',
              'state.json',
              'result.json',
              'report.html',
              'retention.json',
            ].map(async (file) => [
              file,
              await sha256File(path.join(directory, file)),
            ]),
          ),
        ),
      });
      try {
        await finishResearchRetention(projectRoot, directory);
      } catch (error) {
        parameters.onProgress?.(
          `Исследование завершено, очистка ожидает устранения причины: ${String(error)}`,
        );
      }
      parameters.onProgress?.(
        `Итог: ${conclusion.status}. Отчёт: ${path.join(directory, 'report.html')}`,
      );
      return { directory, state, conclusion };
    } catch (error) {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : String(error);
      await save();
      const conclusion: ResearchConclusion = {
        status: 'data-error',
        selectedId: null,
        directionSelections: [],
        reasons: [state.error],
        nextAction:
          'Устранить причину и повторить run с тем же spec; завершённые этапы не запускаются заново.',
        evaluations: [],
        trials: {
          core: spec.core.variants.length,
          predicates: 0,
          combinations: 0,
          frozenGates: 0,
        },
      };
      await writeJsonAtomic(path.join(directory, 'result.json'), conclusion);
      await fs.writeFile(
        path.join(directory, 'report.html'),
        buildStrategyResearchReport({ spec, state, conclusion, diagnostics }),
      );
      throw error;
    }
  });
};
