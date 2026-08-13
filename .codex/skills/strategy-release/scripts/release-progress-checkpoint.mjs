#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const HARD_LIMITATIONS = new Set([
  'causal_leakage',
  'reconciliation_failure',
  'partial_or_failed_run',
  'state_isolation_failure',
  'missing_causal_data',
]);

const MICRO_FORWARD_LIMITATIONS = new Set([
  'retrospective_current_universe',
  'exposed_holdout',
  'missing_effective_dated_membership',
  'missing_historical_patch',
]);

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be boolean`);
  }
}

function nextIncompleteFamily(families) {
  if (!Array.isArray(families) || families.length !== 3) {
    throw new Error('families must contain exactly three entries');
  }
  for (const [index, family] of families.entries()) {
    if (!family?.id || !['active', 'retired'].includes(family.status)) {
      throw new Error(`families[${index}] has invalid identity/status`);
    }
    if (!Number.isInteger(family.roundsCompleted)) {
      throw new Error(`families[${index}].roundsCompleted must be an integer`);
    }
    if (family.roundsCompleted < 0 || family.roundsCompleted > 3) {
      throw new Error(`families[${index}].roundsCompleted must be within 0..3`);
    }
    if (family.status === 'retired' && !family.hardStopReason) {
      throw new Error(`retired family ${family.id} requires hardStopReason`);
    }
  }
  const active = families.filter(
    (family) => family.status === 'active' && family.roundsCompleted < 3,
  );
  if (!active.length) return null;
  const minimumRound = Math.min(
    ...active.map((family) => family.roundsCompleted),
  );
  return active.find((family) => family.roundsCompleted === minimumRound);
}

export function evaluateReleaseProgress(input) {
  assertBoolean(input?.historyAuditComplete, 'historyAuditComplete');
  assertBoolean(input?.baseline?.complete, 'baseline.complete');
  assertBoolean(input?.baseline?.reconciled, 'baseline.reconciled');
  assertBoolean(input?.opportunityMapComplete, 'opportunityMapComplete');
  assertBoolean(input?.hypothesisPortfolioFrozen, 'hypothesisPortfolioFrozen');
  assertBoolean(input?.rescueBoardComplete, 'rescueBoardComplete');
  assertBoolean(
    input?.directionPolicyCheckpoint?.required,
    'directionPolicyCheckpoint.required',
  );
  assertBoolean(
    input?.directionPolicyCheckpoint?.complete,
    'directionPolicyCheckpoint.complete',
  );
  assertBoolean(input?.fullAiReportComplete, 'fullAiReportComplete');
  assertBoolean(input?.chartComplete, 'chartComplete');

  const limitations = Array.isArray(input.limitations)
    ? [...new Set(input.limitations)]
    : [];
  const hardLimitations = limitations.filter((entry) =>
    HARD_LIMITATIONS.has(entry),
  );
  const evidenceCeiling = hardLimitations.length
    ? 'invalid_evidence'
    : limitations.some((entry) => MICRO_FORWARD_LIMITATIONS.has(entry))
      ? 'micro_forward_only'
      : 'historical_ready_eligible';

  const result = (nextAction, phase, reason, verdictAllowed = false) => ({
    schema: 'tradejs-release-progress/v1',
    status: verdictAllowed ? 'complete' : 'continue',
    phase,
    nextAction,
    verdictAllowed,
    evidenceCeiling,
    limitations,
    reason,
  });

  if (hardLimitations.length) {
    return result(
      'REPAIR_INVALID_EVIDENCE',
      'evidence',
      `Repair hard-invalid evidence: ${hardLimitations.join(', ')}.`,
    );
  }
  if (!input.historyAuditComplete) {
    return result(
      'COMPLETE_HISTORY_AUDIT',
      'history',
      'The history inventory and stronger-result bridge are incomplete.',
    );
  }
  if (!input.baseline.complete || !input.baseline.reconciled) {
    return result(
      'RUN_RECONCILED_BASELINE',
      'baseline',
      'A complete reconciled control baseline is required.',
    );
  }
  if (!input.opportunityMapComplete) {
    return result(
      'BUILD_OPPORTUNITY_MAP',
      'diagnosis',
      'Translate metrics, traces, identities, and code semantics into ranked causal opportunities.',
    );
  }
  if (!input.hypothesisPortfolioFrozen) {
    return result(
      'FREEZE_HYPOTHESIS_PORTFOLIO',
      'diagnosis',
      'Choose strategy-specific exploit, repair, and explore/falsify mechanisms before round 1.',
    );
  }

  const family = nextIncompleteFamily(input.families);
  if (family) {
    return result(
      `RUN_CORE_ROUND_${family.roundsCompleted + 1}`,
      'core',
      `Continue causal family ${family.id}; audit or provenance limitations do not consume this round.`,
    );
  }
  if (!input.rescueBoardComplete) {
    return result(
      'RUN_CADENCE_RESCUE_BOARD',
      'rescue',
      'The bounded core rescue board is incomplete.',
    );
  }
  if (
    input.directionPolicyCheckpoint.required &&
    !input.directionPolicyCheckpoint.complete
  ) {
    return result(
      'RUN_DIRECTION_POLICY_CHECKPOINT',
      'gate',
      'A useful/hidden side requires the frozen direction-policy checkpoint.',
    );
  }
  if (!input.fullAiReportComplete) {
    return result(
      'GENERATE_FULL_AI_REPORT',
      'report',
      'The complete ai-train-local-research report is missing.',
    );
  }
  if (!input.chartComplete) {
    return result(
      'GENERATE_FULL_PERIOD_CHART',
      'report',
      'The full-period local deterministic chart is missing.',
    );
  }
  return result(
    evidenceCeiling === 'micro_forward_only'
      ? 'DECIDE_PROSPECTIVE_MICRO_FORWARD'
      : 'DECIDE_RELEASE',
    'decision',
    evidenceCeiling === 'micro_forward_only'
      ? 'Historical claims are capped, but the immutable composition may proceed to prospective risk-1 decision.'
      : 'The bounded release contour is complete.',
    true,
  );
}

async function main() {
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex === -1 || !process.argv[inputIndex + 1]) {
    throw new Error(
      'Usage: release-progress-checkpoint.mjs --input <progress.json>',
    );
  }
  const input = JSON.parse(
    await readFile(process.argv[inputIndex + 1], 'utf8'),
  );
  process.stdout.write(
    `${JSON.stringify(evaluateReleaseProgress(input), null, 2)}\n`,
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
