#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INPUT_SCHEMA = 'tradejs-release-progress-input/v2';
const OUTPUT_SCHEMA = 'tradejs-release-progress/v2';
const SHA256_RE = /^[a-f0-9]{64}$/;

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

const REVALIDATION_DISPOSITIONS = new Set([
  'rescored',
  'bridge-rerun',
  'rejected',
  'partial',
  'unreconstructable',
  'new-trial-required',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBoolean(value, label) {
  assert(typeof value === 'boolean', `${label} must be boolean`);
}

function assertIdentity(value, label) {
  assert(typeof value === 'string' && value.trim(), `${label} is required`);
}

function verifyArtifact(reference, label, artifactRoot, { json = true } = {}) {
  assert(reference && typeof reference === 'object', `${label} is required`);
  assertIdentity(reference.path, `${label}.path`);
  assert(
    SHA256_RE.test(reference.sha256),
    `${label}.sha256 must be a lowercase SHA-256`,
  );
  const artifactPath = path.resolve(artifactRoot, reference.path);
  let content;
  try {
    content = readFileSync(artifactPath);
  } catch (error) {
    throw new Error(
      `${label} cannot be read at ${artifactPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const actualSha256 = createHash('sha256').update(content).digest('hex');
  assert(
    actualSha256 === reference.sha256,
    `${label} SHA-256 mismatch at ${artifactPath}`,
  );
  if (!json) return { artifactPath, content };
  try {
    return {
      artifactPath,
      content,
      value: JSON.parse(content.toString('utf8')),
    };
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function verifyResearchEvidence(
  evidence,
  label,
  artifactRoot,
  { expectedRound } = {},
) {
  assertIdentity(evidence?.researchId, `${label}.researchId`);
  const manifest = verifyArtifact(
    evidence.manifestArtifact,
    `${label}.manifestArtifact`,
    artifactRoot,
  ).value;
  const resultReference = evidence.resultArtifact;
  const result = verifyArtifact(
    resultReference,
    `${label}.resultArtifact`,
    artifactRoot,
  ).value;
  const handoff = verifyArtifact(
    evidence.handoffArtifact,
    `${label}.handoffArtifact`,
    artifactRoot,
  ).value;
  assert(
    manifest?.schema === 'tradejs-core-research-manifest/v1' &&
      manifest.researchId === evidence.researchId &&
      manifest.status === 'completed',
    `${label} requires a completed matching core-research manifest`,
  );
  assert(
    result?.schema === 'tradejs-core-research-result/v1' &&
      result.researchId === evidence.researchId,
    `${label} requires a matching core-research result`,
  );
  assert(
    handoff?.schema === 'tradejs-release-causal-handoff/v1' &&
      handoff.researchId === evidence.researchId &&
      handoff.traceCoverage === 'complete' &&
      handoff.resultSha256 === resultReference.sha256,
    `${label} requires a complete matching causal handoff bound to result SHA-256`,
  );
  if (expectedRound !== undefined) {
    assert(
      handoff.round === expectedRound,
      `${label} causal handoff round must equal ${expectedRound}`,
    );
  }
  assert(
    Array.isArray(evidence.traceArtifacts) && evidence.traceArtifacts.length,
    `${label}.traceArtifacts must contain at least one trace`,
  );
  const declaredTraceHashes = new Set(
    Object.values(result.artifactHashes ?? {}),
  );
  for (const [index, traceReference] of evidence.traceArtifacts.entries()) {
    verifyArtifact(
      traceReference,
      `${label}.traceArtifacts[${index}]`,
      artifactRoot,
      { json: false },
    );
    assert(
      declaredTraceHashes.has(traceReference.sha256),
      `${label}.traceArtifacts[${index}] is not declared by result.artifactHashes`,
    );
  }
}

function validateObjectiveAndRevalidation(input, artifactRoot, history) {
  const objectiveReference = input?.objectiveContract?.artifact;
  const objective = verifyArtifact(
    objectiveReference,
    'objectiveContract.artifact',
    artifactRoot,
  ).value;
  assert(
    objective?.schema === 'tradejs-release-objective/v2' &&
      objective.strategy === input.strategy &&
      objective.lineageId === input.lineageId,
    'objectiveContract artifact must match the v2 strategy and lineage',
  );

  assertBoolean(
    input?.candidateRevalidation?.required,
    'candidateRevalidation.required',
  );
  assert(
    input.candidateRevalidation.required,
    'candidateRevalidation.required must be true in release mode',
  );
  assertBoolean(
    input.candidateRevalidation.complete,
    'candidateRevalidation.complete',
  );
  if (!input.candidateRevalidation.complete) {
    return objectiveReference.sha256;
  }

  assert(
    history,
    'candidateRevalidation cannot complete before the history inventory',
  );

  const revalidation = verifyArtifact(
    input.candidateRevalidation.artifact,
    'candidateRevalidation.artifact',
    artifactRoot,
  ).value;
  assert(
    revalidation?.schema === 'tradejs-release-candidate-revalidation/v2' &&
      revalidation.strategy === input.strategy &&
      revalidation.lineageId === input.lineageId &&
      revalidation.objectiveFingerprint === objectiveReference.sha256 &&
      revalidation.historyInventorySha256 === history.reference.sha256 &&
      revalidation.status === 'complete',
    'candidateRevalidation artifact must match the v2 objective, strategy, lineage, and history inventory',
  );
  const revalidatedIndexes = Array.isArray(revalidation.candidates)
    ? revalidation.candidates.map((candidate) => candidate?.historyEntryIndex)
    : [];
  assert(
    Number.isInteger(revalidation.priorCandidateCount) &&
      revalidation.priorCandidateCount >= 0 &&
      Array.isArray(revalidation.candidates) &&
      revalidation.candidates.length === revalidation.priorCandidateCount &&
      revalidation.priorCandidateCount === history.candidateIndexes.length &&
      revalidation.candidates.every((candidate) =>
        REVALIDATION_DISPOSITIONS.has(candidate?.disposition),
      ) &&
      revalidatedIndexes.every(Number.isInteger) &&
      new Set(revalidatedIndexes).size === revalidatedIndexes.length &&
      [...revalidatedIndexes]
        .sort((a, b) => a - b)
        .every(
          (entryIndex, index) => entryIndex === history.candidateIndexes[index],
        ) &&
      Array.isArray(revalidation.unresolved) &&
      revalidation.unresolved.length === 0,
    'candidateRevalidation must dispose every deduplicated prior candidate from the bound history inventory exactly once',
  );
  const trialLedger = verifyArtifact(
    revalidation.trialLedger,
    'candidateRevalidation.trialLedger',
    artifactRoot,
  ).value;
  assert(
    trialLedger?.schema === 'tradejs-release-trial-ledger/v2' &&
      Array.isArray(trialLedger.candidates),
    'candidateRevalidation.trialLedger must use the v2 trial-ledger schema',
  );
  return objectiveReference.sha256;
}

function validateHistoryArtifact(input, artifactRoot) {
  assertBoolean(input?.historyAudit?.complete, 'historyAudit.complete');
  if (!input.historyAudit.complete) return null;
  const reference = input.historyAudit.artifact;
  const inventory = verifyArtifact(
    reference,
    'historyAudit.artifact',
    artifactRoot,
  ).value;
  assert(
    inventory?.schema === 'tradejs-strategy-hypothesis-inventory/v1' &&
      inventory.strategy === input.strategy &&
      Array.isArray(inventory.entries),
    'historyAudit artifact must be a matching hypothesis inventory',
  );
  const excludedStatuses = new Set([
    'refactor-no-hypothesis',
    'superseded-duplicate',
  ]);
  return {
    reference,
    inventory,
    candidateIndexes: inventory.entries.flatMap((entry, index) =>
      excludedStatuses.has(entry?.status) ? [] : [index],
    ),
  };
}

function validateFamilies(families, artifactRoot) {
  assert(
    Array.isArray(families) && families.length === 3,
    'families must contain exactly three entries',
  );
  for (const [index, family] of families.entries()) {
    assert(
      family?.id && ['active', 'retired'].includes(family.status),
      `families[${index}] has invalid identity/status`,
    );
    assert(
      Array.isArray(family.roundArtifacts) && family.roundArtifacts.length <= 3,
      `families[${index}].roundArtifacts must contain 0..3 entries`,
    );
    family.roundArtifacts.forEach((roundEvidence, roundIndex) => {
      const expectedRound = roundIndex + 1;
      assert(
        roundEvidence.round === expectedRound,
        `families[${index}].roundArtifacts must be sequential from round 1`,
      );
      verifyResearchEvidence(
        roundEvidence,
        `families[${index}].roundArtifacts[${roundIndex}]`,
        artifactRoot,
        { expectedRound },
      );
    });
    if (family.status === 'retired') {
      assertIdentity(
        family.hardStopReason,
        `retired family ${family.id}.hardStopReason`,
      );
      if (family.roundArtifacts.length < 3) {
        verifyArtifact(
          family.retirementArtifact,
          `retired family ${family.id}.retirementArtifact`,
          artifactRoot,
        );
      }
    }
  }
}

function nextIncompleteFamily(families) {
  const active = families.filter(
    (family) => family.status === 'active' && family.roundArtifacts.length < 3,
  );
  if (!active.length) return null;
  const minimumRound = Math.min(
    ...active.map((family) => family.roundArtifacts.length),
  );
  return active.find((family) => family.roundArtifacts.length === minimumRound);
}

function validateRescueBoard(input, artifactRoot, objectiveFingerprint) {
  assertBoolean(input?.rescueBoard?.complete, 'rescueBoard.complete');
  if (!input.rescueBoard.complete) return;
  const board = verifyArtifact(
    input.rescueBoard.artifact,
    'rescueBoard.artifact',
    artifactRoot,
  ).value;
  assert(
    board?.schema === 'tradejs-release-rescue-board/v2' &&
      board.strategy === input.strategy &&
      board.lineageId === input.lineageId &&
      board.objectiveFingerprint === objectiveFingerprint &&
      Array.isArray(board.children) &&
      board.children.length <= 3 &&
      Array.isArray(board.missingSlots) &&
      board.children.length + board.missingSlots.length === 3,
    'rescueBoard artifact must bind the v2 objective and account for three slots',
  );
  board.children.forEach((child, index) =>
    verifyResearchEvidence(
      child,
      `rescueBoard.children[${index}]`,
      artifactRoot,
    ),
  );
}

function validateCheckpoint(checkpoint, label, artifactRoot) {
  assertBoolean(checkpoint?.required, `${label}.required`);
  assertBoolean(checkpoint?.complete, `${label}.complete`);
  if (checkpoint.required && checkpoint.complete) {
    verifyArtifact(checkpoint.artifact, `${label}.artifact`, artifactRoot);
  }
}

function validateCompletionArtifact(section, label, artifactRoot) {
  assertBoolean(section?.complete, `${label}.complete`);
  if (section.complete) {
    verifyArtifact(section.artifact, `${label}.artifact`, artifactRoot);
  }
}

function validateSelectedComposition(
  input,
  artifactRoot,
  objectiveFingerprint,
) {
  if (!input.selectedComposition) return null;
  assertIdentity(
    input.selectedComposition.candidateId,
    'selectedComposition.candidateId',
  );
  assert(
    SHA256_RE.test(input.selectedComposition.compositionFingerprint),
    'selectedComposition.compositionFingerprint must be a lowercase SHA-256',
  );
  const artifactReference = input.selectedComposition.artifact;
  const selected = verifyArtifact(
    artifactReference,
    'selectedComposition.artifact',
    artifactRoot,
  ).value;
  assert(
    selected?.schema === 'tradejs-release-selected-composition/v2' &&
      selected.strategy === input.strategy &&
      selected.lineageId === input.lineageId &&
      selected.objectiveFingerprint === objectiveFingerprint &&
      selected.candidateId === input.selectedComposition.candidateId &&
      selected.compositionFingerprint ===
        input.selectedComposition.compositionFingerprint &&
      selected.chartSha256 === input.chart.artifact.sha256,
    'selectedComposition artifact must match strategy, lineage, objective, candidate, composition, and chart',
  );
  return {
    candidateId: selected.candidateId,
    compositionFingerprint: selected.compositionFingerprint,
    artifactSha256: artifactReference.sha256,
  };
}

export function evaluateReleaseProgress(input, options = {}) {
  const artifactRoot = path.resolve(options.artifactRoot ?? process.cwd());
  assert(input?.schema === INPUT_SCHEMA, `schema must equal ${INPUT_SCHEMA}`);
  assertIdentity(input.strategy, 'strategy');
  assertIdentity(input.lineageId, 'lineageId');

  const history = validateHistoryArtifact(input, artifactRoot);
  const objectiveFingerprint = validateObjectiveAndRevalidation(
    input,
    artifactRoot,
    history,
  );
  assertBoolean(input?.baseline?.complete, 'baseline.complete');
  assertBoolean(input?.baseline?.reconciled, 'baseline.reconciled');
  if (input.baseline.complete) {
    verifyArtifact(input.baseline.artifact, 'baseline.artifact', artifactRoot);
  }
  validateCompletionArtifact(
    input.opportunityMap,
    'opportunityMap',
    artifactRoot,
  );
  assertBoolean(
    input?.hypothesisPortfolio?.frozen,
    'hypothesisPortfolio.frozen',
  );
  if (input.hypothesisPortfolio.frozen) {
    verifyArtifact(
      input.hypothesisPortfolio.artifact,
      'hypothesisPortfolio.artifact',
      artifactRoot,
    );
  }
  validateFamilies(input.families, artifactRoot);
  validateRescueBoard(input, artifactRoot, objectiveFingerprint);
  validateCheckpoint(
    input.directionalParameterCheckpoint,
    'directionalParameterCheckpoint',
    artifactRoot,
  );
  validateCheckpoint(
    input.directionPolicyCheckpoint,
    'directionPolicyCheckpoint',
    artifactRoot,
  );
  validateCompletionArtifact(input.fullAiReport, 'fullAiReport', artifactRoot);
  validateCompletionArtifact(input.chart, 'chart', artifactRoot);

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

  const result = (
    nextAction,
    phase,
    reason,
    verdictAllowed = false,
    selectedComposition = null,
  ) => ({
    schema: OUTPUT_SCHEMA,
    strategy: input.strategy,
    lineageId: input.lineageId,
    objectiveFingerprint,
    status: verdictAllowed ? 'complete' : 'continue',
    phase,
    nextAction,
    verdictAllowed,
    evidenceCeiling,
    limitations,
    selectedComposition,
    reason,
  });

  if (hardLimitations.length) {
    return result(
      'REPAIR_INVALID_EVIDENCE',
      'evidence',
      `Repair hard-invalid evidence: ${hardLimitations.join(', ')}.`,
    );
  }
  if (!input.historyAudit.complete) {
    return result(
      'COMPLETE_HISTORY_AUDIT',
      'history',
      'The history inventory and stronger-result bridge are incomplete.',
    );
  }
  if (!input.candidateRevalidation.complete) {
    return result(
      'REVALIDATE_HISTORICAL_CANDIDATES',
      'history',
      'Re-score and bridge every reconstructable historical candidate under the frozen objective.',
    );
  }
  if (!input.baseline.complete || !input.baseline.reconciled) {
    return result(
      'RUN_RECONCILED_BASELINE',
      'baseline',
      'A complete reconciled control baseline is required.',
    );
  }
  if (!input.opportunityMap.complete) {
    return result(
      'BUILD_OPPORTUNITY_MAP',
      'diagnosis',
      'Translate revalidated candidates, metrics, traces, identities, and code semantics into ranked causal opportunities.',
    );
  }
  if (!input.hypothesisPortfolio.frozen) {
    return result(
      'FREEZE_HYPOTHESIS_PORTFOLIO',
      'diagnosis',
      'Choose strategy-specific exploit, repair, and explore/falsify mechanisms before round 1.',
    );
  }
  if (
    input.directionalParameterCheckpoint.required &&
    !input.directionalParameterCheckpoint.complete
  ) {
    return result(
      'FREEZE_DIRECTIONAL_PARAMETER_SPLIT',
      'core',
      'A supported opposing side effect requires a directional parameter ablation before more adaptation.',
    );
  }

  const family = nextIncompleteFamily(input.families);
  if (family) {
    return result(
      `RUN_CORE_ROUND_${family.roundArtifacts.length + 1}`,
      'core',
      `Continue causal family ${family.id}; audit, revalidation, and provenance limitations do not consume this new round.`,
    );
  }
  if (!input.rescueBoard.complete) {
    return result(
      'RUN_CADENCE_RESCUE_BOARD',
      'rescue',
      'The artifact-backed bounded core rescue board is incomplete.',
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
  if (!input.fullAiReport.complete) {
    return result(
      'GENERATE_FULL_AI_REPORT',
      'report',
      'The complete ai-train-local-research report is missing.',
    );
  }
  if (!input.chart.complete) {
    return result(
      'GENERATE_FULL_PERIOD_CHART',
      'report',
      'The full-period local deterministic chart is missing.',
    );
  }
  const selectedComposition = validateSelectedComposition(
    input,
    artifactRoot,
    objectiveFingerprint,
  );
  if (!selectedComposition) {
    return result(
      'FREEZE_SELECTED_COMPOSITION',
      'decision',
      'Bind one candidate/composition to the objective, historical matrix, and chart before deciding.',
    );
  }
  return result(
    evidenceCeiling === 'micro_forward_only'
      ? 'DECIDE_PROSPECTIVE_MICRO_FORWARD'
      : 'DECIDE_RELEASE',
    'decision',
    evidenceCeiling === 'micro_forward_only'
      ? 'Historical claims are capped, but the immutable selected composition may proceed to prospective risk-1 decision.'
      : 'The artifact-backed bounded release contour is complete.',
    true,
    selectedComposition,
  );
}

function main() {
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex === -1 || !process.argv[inputIndex + 1]) {
    throw new Error(
      'Usage: release-progress-checkpoint.mjs --input <progress.json>',
    );
  }
  const input = JSON.parse(readFileSync(process.argv[inputIndex + 1], 'utf8'));
  process.stdout.write(
    `${JSON.stringify(
      evaluateReleaseProgress(input, { artifactRoot: process.cwd() }),
      null,
      2,
    )}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
