import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { evaluateReleaseProgress } from './release-progress-checkpoint.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'release-progress-v2-'));
after(() => rmSync(root, { recursive: true, force: true }));

const fileReference = (name, content) => {
  const filePath = path.join(root, name);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  writeFileSync(filePath, buffer);
  return {
    path: filePath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
};

const jsonReference = (name, value) =>
  fileReference(name, `${JSON.stringify(value, null, 2)}\n`);

const strategy = 'LiquidityTails';
const lineageId = 'liquidity-tails-release-20260821';
const objectiveArtifact = jsonReference('objective.json', {
  schema: 'tradejs-release-objective/v2',
  strategy,
  lineageId,
});
const trialLedger = jsonReference('trial-ledger.json', {
  schema: 'tradejs-release-trial-ledger/v2',
  candidates: [],
});
const historyArtifact = jsonReference('history.json', {
  schema: 'tradejs-strategy-hypothesis-inventory/v1',
  strategy,
  entries: [],
});
const revalidationArtifact = jsonReference('revalidation.json', {
  schema: 'tradejs-release-candidate-revalidation/v2',
  strategy,
  lineageId,
  objectiveFingerprint: objectiveArtifact.sha256,
  historyInventorySha256: historyArtifact.sha256,
  status: 'complete',
  priorCandidateCount: 0,
  candidates: [],
  unresolved: [],
  trialLedger,
});
const baselineArtifact = jsonReference('baseline.json', {
  schema: 'tradejs-core-research-result/v1',
  researchId: 'baseline',
});
const opportunityArtifact = jsonReference('opportunity.json', {
  schema: 'tradejs-release-opportunity-map/v2',
});
const portfolioArtifact = jsonReference('portfolio.json', {
  schema: 'tradejs-release-hypothesis-portfolio/v2',
});
const reportArtifact = jsonReference('report.json', { report: 'complete' });
const chartArtifact = jsonReference('chart.json', { chart: 'complete' });

const roundEvidence = (family, round) => {
  const researchId = `${family}-round-${round}`;
  const traceArtifact = fileReference(
    `${researchId}-trace.jsonl`,
    `${JSON.stringify({ researchId, event: 'entry' })}\n`,
  );
  const manifestArtifact = jsonReference(`${researchId}-manifest.json`, {
    schema: 'tradejs-core-research-manifest/v1',
    researchId,
    status: 'completed',
  });
  const resultArtifact = jsonReference(`${researchId}-result.json`, {
    schema: 'tradejs-core-research-result/v1',
    researchId,
    artifactHashes: { trace: traceArtifact.sha256 },
  });
  const handoffArtifact = jsonReference(`${researchId}-handoff.json`, {
    schema: 'tradejs-release-causal-handoff/v1',
    researchId,
    round,
    traceCoverage: 'complete',
    resultSha256: resultArtifact.sha256,
  });
  return {
    round,
    researchId,
    manifestArtifact,
    resultArtifact,
    traceArtifacts: [traceArtifact],
    handoffArtifact,
  };
};

const completedFamily = (id) => ({
  id,
  status: 'active',
  roundArtifacts: [1, 2, 3].map((round) => roundEvidence(id, round)),
});

const completedFamilies = [
  completedFamily('lifecycle'),
  completedFamily('geometry'),
  completedFamily('participation'),
];
const rescueArtifact = jsonReference('rescue.json', {
  schema: 'tradejs-release-rescue-board/v2',
  strategy,
  lineageId,
  objectiveFingerprint: objectiveArtifact.sha256,
  children: [],
  missingSlots: [
    'no distinct cadence seed',
    'no second distinct cadence seed',
    'no third distinct cadence seed',
  ],
});
const compositionFingerprint = 'c'.repeat(64);
const selectedCompositionArtifact = jsonReference('selected.json', {
  schema: 'tradejs-release-selected-composition/v2',
  strategy,
  lineageId,
  candidateId: 'candidate-1',
  compositionFingerprint,
  objectiveFingerprint: objectiveArtifact.sha256,
  historicalMatrixSha256: 'd'.repeat(64),
  chartSha256: chartArtifact.sha256,
});

const input = (overrides = {}) => ({
  schema: 'tradejs-release-progress-input/v2',
  strategy,
  lineageId,
  objectiveContract: { artifact: objectiveArtifact },
  historyAudit: { complete: true, artifact: historyArtifact },
  candidateRevalidation: {
    required: true,
    complete: true,
    artifact: revalidationArtifact,
  },
  baseline: {
    complete: true,
    reconciled: true,
    artifact: baselineArtifact,
  },
  opportunityMap: { complete: true, artifact: opportunityArtifact },
  hypothesisPortfolio: { frozen: true, artifact: portfolioArtifact },
  families: [
    { id: 'lifecycle', status: 'active', roundArtifacts: [] },
    { id: 'geometry', status: 'active', roundArtifacts: [] },
    { id: 'participation', status: 'active', roundArtifacts: [] },
  ],
  rescueBoard: { complete: false },
  directionalParameterCheckpoint: { required: false, complete: false },
  directionPolicyCheckpoint: { required: false, complete: false },
  fullAiReport: { complete: false },
  chart: { complete: false },
  selectedComposition: null,
  limitations: [],
  ...overrides,
});

test('requires round 1 despite provenance limitations', () => {
  const result = evaluateReleaseProgress(
    input({
      limitations: [
        'retrospective_current_universe',
        'missing_effective_dated_membership',
        'exposed_holdout',
      ],
    }),
  );

  assert.equal(result.nextAction, 'RUN_CORE_ROUND_1');
  assert.equal(result.evidenceCeiling, 'micro_forward_only');
  assert.equal(result.verdictAllowed, false);
});

test('requires historical candidate revalidation before the baseline', () => {
  const result = evaluateReleaseProgress(
    input({
      candidateRevalidation: { required: true, complete: false },
    }),
  );

  assert.equal(result.nextAction, 'REVALIDATE_HISTORICAL_CANDIDATES');
  assert.equal(result.phase, 'history');
});

test('rejects a zero-candidate revalidation when history contains prior behavior', () => {
  const populatedHistory = jsonReference('populated-history.json', {
    schema: 'tradejs-strategy-hypothesis-inventory/v1',
    strategy,
    entries: [
      {
        status: 'verified-result',
        behaviorSha256: 'a'.repeat(64),
      },
      { status: 'refactor-no-hypothesis' },
    ],
  });
  const incompleteRevalidation = jsonReference('incomplete-revalidation.json', {
    schema: 'tradejs-release-candidate-revalidation/v2',
    strategy,
    lineageId,
    objectiveFingerprint: objectiveArtifact.sha256,
    historyInventorySha256: populatedHistory.sha256,
    status: 'complete',
    priorCandidateCount: 0,
    candidates: [],
    unresolved: [],
    trialLedger,
  });

  assert.throws(
    () =>
      evaluateReleaseProgress(
        input({
          historyAudit: { complete: true, artifact: populatedHistory },
          candidateRevalidation: {
            required: true,
            complete: true,
            artifact: incompleteRevalidation,
          },
        }),
      ),
    /every deduplicated prior candidate/,
  );
});

test('does not trust a declared roundsCompleted count without artifacts', () => {
  const result = evaluateReleaseProgress(
    input({
      families: [
        {
          id: 'lifecycle',
          status: 'active',
          roundsCompleted: 3,
          roundArtifacts: [],
        },
        { id: 'geometry', status: 'active', roundArtifacts: [] },
        { id: 'participation', status: 'active', roundArtifacts: [] },
      ],
    }),
  );

  assert.equal(result.nextAction, 'RUN_CORE_ROUND_1');
  assert.match(result.reason, /lifecycle/);
});

test('rejects a round whose result hash is not bound by the handoff', () => {
  const invalidRound = roundEvidence('invalid', 1);
  invalidRound.handoffArtifact = jsonReference(
    'invalid-handoff-rewritten.json',
    {
      schema: 'tradejs-release-causal-handoff/v1',
      researchId: invalidRound.researchId,
      round: 1,
      traceCoverage: 'complete',
      resultSha256: '0'.repeat(64),
    },
  );

  assert.throws(
    () =>
      evaluateReleaseProgress(
        input({
          families: [
            { id: 'invalid', status: 'active', roundArtifacts: [invalidRound] },
            { id: 'geometry', status: 'active', roundArtifacts: [] },
            { id: 'participation', status: 'active', roundArtifacts: [] },
          ],
        }),
      ),
    /bound to result SHA-256/,
  );
});

test('allows a complete artifact-backed limited-provenance contour to decide', () => {
  const result = evaluateReleaseProgress(
    input({
      families: completedFamilies,
      rescueBoard: { complete: true, artifact: rescueArtifact },
      fullAiReport: { complete: true, artifact: reportArtifact },
      chart: { complete: true, artifact: chartArtifact },
      selectedComposition: {
        candidateId: 'candidate-1',
        compositionFingerprint,
        artifact: selectedCompositionArtifact,
      },
      limitations: ['retrospective_current_universe', 'exposed_holdout'],
    }),
  );

  assert.equal(result.status, 'complete');
  assert.equal(result.verdictAllowed, true);
  assert.equal(result.nextAction, 'DECIDE_PROSPECTIVE_MICRO_FORWARD');
  assert.equal(result.schema, 'tradejs-release-progress/v2');
  assert.equal(result.selectedComposition.candidateId, 'candidate-1');
});

test('requires a selected composition after report and chart', () => {
  const result = evaluateReleaseProgress(
    input({
      families: completedFamilies,
      rescueBoard: { complete: true, artifact: rescueArtifact },
      fullAiReport: { complete: true, artifact: reportArtifact },
      chart: { complete: true, artifact: chartArtifact },
    }),
  );

  assert.equal(result.nextAction, 'FREEZE_SELECTED_COMPOSITION');
  assert.equal(result.verdictAllowed, false);
});

test('stops the invalid evidence path on causal leakage', () => {
  const result = evaluateReleaseProgress(
    input({ limitations: ['causal_leakage'] }),
  );

  assert.equal(result.nextAction, 'REPAIR_INVALID_EVIDENCE');
  assert.equal(result.evidenceCeiling, 'invalid_evidence');
});

test('requires a hashed reason when a family retires before round 3', () => {
  assert.throws(
    () =>
      evaluateReleaseProgress(
        input({
          families: [
            {
              id: 'lifecycle',
              status: 'retired',
              hardStopReason: 'mechanism_falsified',
              roundArtifacts: [],
            },
            { id: 'geometry', status: 'active', roundArtifacts: [] },
            { id: 'participation', status: 'active', roundArtifacts: [] },
          ],
        }),
      ),
    /retirementArtifact is required/,
  );
});
