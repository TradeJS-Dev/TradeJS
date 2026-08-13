#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const EFFECTS = new Set(['improved', 'worsened', 'neutral', 'inconclusive']);
const RESOLUTIONS = new Set([
  'decision_time',
  'detector_state',
  'shared_lifecycle',
]);

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be boolean`);
  }
}

function readSide(evidence, side) {
  const value = evidence?.[side];
  if (!EFFECTS.has(value?.effect)) {
    throw new Error(`${side}.effect must be a supported effect`);
  }
  assertBoolean(value.supportAdequate, `${side}.supportAdequate`);
  return value;
}

export function evaluateDirectionalParameterCheckpoint(input) {
  const parameter = input?.parameter;
  const evidence = input?.evidence;
  if (!parameter?.name) throw new Error('parameter.name is required');
  if (!RESOLUTIONS.has(parameter.resolution)) {
    throw new Error('parameter.resolution is invalid');
  }
  assertBoolean(parameter.isolatedChange, 'parameter.isolatedChange');
  assertBoolean(
    parameter.legacyFallbackSupported,
    'parameter.legacyFallbackSupported',
  );
  assertBoolean(evidence?.complete, 'evidence.complete');
  assertBoolean(evidence?.reconciled, 'evidence.reconciled');
  assertBoolean(
    evidence?.intendedTransitionChanged,
    'evidence.intendedTransitionChanged',
  );
  const long = readSide(evidence, 'LONG');
  const short = readSide(evidence, 'SHORT');

  const result = (overrides) => ({
    schema: 'tradejs-directional-parameter-checkpoint/v1',
    parameter: parameter.name,
    required: false,
    targetDirection: null,
    implementationMode: null,
    action: 'KEEP_GLOBAL_PARAMETER',
    reason: 'No supported opposing directional effect was established.',
    ...overrides,
  });

  if (!evidence.complete || !evidence.reconciled) {
    return result({
      action: 'REPAIR_DIRECTIONAL_EVIDENCE',
      reason: 'Directional evidence must be complete and reconciled.',
    });
  }
  if (!parameter.isolatedChange) {
    return result({
      action: 'RUN_SINGLE_PARAMETER_ABLATION',
      reason: 'The observed side conflict is not attributable to one field.',
    });
  }
  if (!evidence.intendedTransitionChanged) {
    return result({
      action: 'REJECT_DIRECTIONAL_NO_OP',
      reason: 'The parameter did not change its intended causal transition.',
    });
  }
  if (
    !long.supportAdequate ||
    !short.supportAdequate ||
    long.effect === 'inconclusive' ||
    short.effect === 'inconclusive'
  ) {
    return result({
      action: 'COLLECT_DIRECTIONAL_EVIDENCE',
      reason: 'Both sides need adequate support under the frozen side rule.',
    });
  }

  const targetDirection =
    long.effect === 'improved' && short.effect === 'worsened'
      ? 'LONG'
      : short.effect === 'improved' && long.effect === 'worsened'
        ? 'SHORT'
        : null;
  if (!targetDirection) return result({});

  if (!parameter.legacyFallbackSupported) {
    return result({
      required: true,
      targetDirection,
      action: 'DESIGN_LEGACY_FALLBACK',
      reason: 'Directional overrides must preserve the original global field.',
    });
  }

  const implementationMode =
    parameter.resolution === 'decision_time'
      ? 'fallback_override'
      : parameter.resolution === 'detector_state'
        ? 'separate_directional_state'
        : 'fallback_override_with_occupancy_audit';
  const action =
    parameter.resolution === 'detector_state'
      ? 'DESIGN_DIRECTIONAL_STATE_ISOLATION'
      : 'FREEZE_DIRECTIONAL_PARAMETER_SPLIT';

  return result({
    required: true,
    targetDirection,
    implementationMode,
    action,
    reason: `${targetDirection} improves while the opposite side worsens under the matched one-field comparison.`,
  });
}

async function main() {
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex === -1 || !process.argv[inputIndex + 1]) {
    throw new Error(
      'Usage: directional-parameter-checkpoint.mjs --input <checkpoint.json>',
    );
  }
  const input = JSON.parse(
    await readFile(process.argv[inputIndex + 1], 'utf8'),
  );
  process.stdout.write(
    `${JSON.stringify(evaluateDirectionalParameterCheckpoint(input), null, 2)}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
