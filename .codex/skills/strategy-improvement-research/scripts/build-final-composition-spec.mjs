#!/usr/bin/env node

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { sha256File, stableStringify } from './final-composition-board.mjs';

const REQUIRED_WINDOWS = [365, 180, 90, 30, 7];

const sha256 = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

const requiredText = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
};

export const buildFinalCompositionSpec = async ({
  selection,
  artifactRoot,
}) => {
  if (selection?.schema !== 'tradejs-final-composition-selection/v1') {
    throw new Error('Invalid final-composition selection schema');
  }
  const baselineSelection = selection.candidates?.find(
    ({ id }) => id === selection.baselineId,
  );
  if (!baselineSelection) {
    throw new Error('baselineId must identify a selection candidate');
  }
  if (
    baselineSelection.role !== 'baseline' ||
    baselineSelection.gateSource !== 'current'
  ) {
    throw new Error(
      'baselineId must identify production core + current AI-gate with gateSource=current',
    );
  }
  const root = path.resolve(artifactRoot);
  const candidates = await Promise.all(
    selection.candidates.map(async (candidate, index) => {
      const prefix = `candidates[${index}]`;
      const gateSource = candidate.gateSource ?? 'variant';
      if (!['current', 'variant'].includes(gateSource)) {
        throw new Error(`${prefix}.gateSource must be current or variant`);
      }
      if (gateSource === 'current' && candidate.id !== selection.baselineId) {
        throw new Error(
          `${prefix}.gateSource=current is reserved for baselineId`,
        );
      }
      const gateReportPath = requiredText(
        candidate.gateReport,
        `${prefix}.gateReport`,
      );
      const report = JSON.parse(
        await fsp.readFile(path.resolve(root, gateReportPath), 'utf8'),
      );
      const artifact = async (declaredPath) => ({
        path: declaredPath,
        sha256: await sha256File(path.resolve(root, declaredPath)),
      });
      const [coreResult, coreExport, gateReport] = await Promise.all([
        artifact(candidate.coreResult),
        artifact(candidate.coreExport),
        artifact(gateReportPath),
      ]);
      let gateAuthority;
      let gateFingerprint;
      let minQuality;
      let variant;
      if (gateSource === 'current') {
        const gateAuthorityPath = requiredText(
          candidate.gateAuthority,
          `${prefix}.gateAuthority`,
        );
        gateAuthority = await artifact(gateAuthorityPath);
        const authority = JSON.parse(
          await fsp.readFile(path.resolve(root, gateAuthorityPath), 'utf8'),
        );
        const authoritySourceHashes =
          authority.research?.lineage?.sourceSha256s ?? [];
        if (!authoritySourceHashes.includes(coreExport.sha256)) {
          throw new Error(
            `${prefix}.gateAuthority is not bound to the declared core export`,
          );
        }
        if (authority.run?.directionPolicy !== candidate.directionPolicy) {
          throw new Error(
            `${prefix}.gateAuthority directionPolicy does not match selection`,
          );
        }
        variant = report.baseline;
        if (!variant) {
          throw new Error(`${prefix} gate report has no current-gate baseline`);
        }
        minQuality = authority.run?.minQuality ?? report.run?.minQuality ?? 4;
        gateFingerprint = sha256(
          stableStringify({
            source: 'current-gate-authority',
            authoritySha256: gateAuthority.sha256,
            runtimeGateFingerprint:
              authority.research?.lineage?.gateFingerprint ?? null,
            mode: authority.run?.mode ?? null,
            minQuality,
            directionPolicy: candidate.directionPolicy,
          }),
        );
      } else {
        variant = report.variants?.find(
          ({ name }) => name === candidate.variantName,
        );
        if (!variant) {
          throw new Error(`${prefix}.variantName is absent from gate report`);
        }
        minQuality = report.run?.minQuality ?? 4;
        gateFingerprint = sha256(
          stableStringify({
            name: variant.name,
            mode: variant.mode,
            quality: variant.quality,
            direction: variant.direction,
            expression: variant.expression,
          }),
        );
      }
      const full = variant.periods?.full;
      if (!full) throw new Error(`${prefix} gate report has no full period`);
      return {
        id: requiredText(candidate.id, `${prefix}.id`),
        label: requiredText(candidate.label, `${prefix}.label`),
        role: candidate.role,
        status: candidate.status,
        color: candidate.color,
        riskUnit: selection.normalization.maxLossValue,
        composition: {
          kind: 'core+deterministic-gate',
          gateSource,
          coreResearchId: candidate.coreResearchId,
          coreConfigSha256: candidate.coreConfigSha256,
          coreResult,
          coreExport,
          gateReport,
          ...(gateAuthority === undefined ? {} : { gateAuthority }),
          gateFingerprint,
          configFingerprint: candidate.coreConfigSha256,
          contextFingerprint: selection.contextFingerprint,
          directionPolicy: candidate.directionPolicy,
          minQuality,
        },
        metrics: {
          trades: full.trades,
          pnl: full.totalProfit,
          profitFactor: full.profitFactor,
          maxDrawdown: full.maxDrawdown,
        },
        terminal: REQUIRED_WINDOWS.map((days) => {
          const period = variant.periods?.[`${days}d`];
          if (!period) throw new Error(`${prefix} is missing ${days}d metrics`);
          return { days, trades: period.trades, pnl: period.totalProfit };
        }),
        equity: variant.equity,
      };
    }),
  );
  return {
    schema: 'tradejs-final-composition-board/v1',
    strategy: selection.strategy,
    researchId: selection.researchId,
    title: selection.title,
    subtitle: selection.subtitle,
    baselineId: selection.baselineId,
    selectedId: selection.selectedId,
    ...(selection.terminalComparisonIds === undefined
      ? {}
      : { terminalComparisonIds: selection.terminalComparisonIds }),
    comparisonWindow: selection.comparisonWindow,
    normalization: selection.normalization,
    limitations: selection.limitations,
    candidates,
  };
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (
      ![
        '--selection',
        '--output',
        '--artifactRoot',
        '--terminalComparisonIds',
      ].includes(name)
    ) {
      throw new Error(`Unknown option: ${name}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--'))
      throw new Error(`${name} requires a value`);
    options[name.slice(2)] = value;
  }
  if (!options.selection || !options.output) {
    throw new Error('Required: --selection and --output');
  }
  const artifactRoot = path.resolve(
    options.artifactRoot || process.env.PROJECT_CWD || process.cwd(),
  );
  const selection = JSON.parse(
    await fsp.readFile(path.resolve(artifactRoot, options.selection), 'utf8'),
  );
  const terminalComparisonIds = options.terminalComparisonIds
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const spec = await buildFinalCompositionSpec({
    selection:
      terminalComparisonIds === undefined
        ? selection
        : { ...selection, terminalComparisonIds },
    artifactRoot,
  });
  const outputPath = path.resolve(artifactRoot, options.output);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  process.stdout.write(`${await sha256File(outputPath)}  ${options.output}\n`);
};

if (
  pathToFileURL(path.resolve(process.argv[1] ?? '')).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
