import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import {
  discoverRuntimeEvidenceBundles,
  verifyRuntimeEvidenceBundle,
} from '../lib/runtimeEvidenceArtifacts';
import { verifyRuntimeFeedbackReplaySource } from '../lib/runtimeFeedbackArtifacts';
import { markRuntimeEvidenceBundleProcessed } from '../lib/runtimeEvidenceSync';
import {
  buildRuntimeScorecard,
  formatRuntimeScorecardMarkdown,
} from '../lib/runtimeScorecard';
import {
  buildStrategyLiveDiagnosisFromScorecard,
  publishStrategyLiveDiagnosis,
  verifyStrategyReleaseEnvelope,
} from '../lib/strategyRelease';

args.option(['u', 'runtimeEvidence'], 'Verified runtime evidence JSON');
args.option(['r', 'replayEvidence'], 'Replay runtime evidence JSON');
args.option(['c', 'calibration'], 'Execution calibration JSON');
args.option(
  ['q', 'prospectiveEvidence'],
  'Verified prospective raw-core/gate/regime summary JSON',
);
args.option(['s', 'strategy'], 'Exact strategy to isolate in the scorecard');
args.option(
  ['H', 'historyDir'],
  'Directory containing verified evidence bundles',
);
args.option(
  ['E', 'evidenceDir'],
  'Local evidence storage root used for processing receipts',
  process.env.RUNTIME_EVIDENCE_LOCAL_DIR || 'data/runtime-evidence',
);
args.option(
  ['d', 'deployment'],
  'Deployment id used for processing receipts',
  process.env.RUNTIME_EVIDENCE_DEPLOYMENT_ID || 'production',
);
args.option(
  ['M', 'markProcessed'],
  'Write a processing receipt on success',
  false,
);
args.option(
  ['P', 'minimumParityRatio'],
  'Minimum acceptable replay parity',
  0.95,
);
args.option(
  ['S', 'maximumSlippageResidualBps'],
  'Maximum acceptable execution residual in bps',
  3,
);
args.option(
  ['L', 'maximumSignalCloseToSubmitMs'],
  'Maximum acceptable average signal-close-to-submit latency in milliseconds',
  30_000,
);
args.option(
  ['T', 'minimumClosedTrades'],
  'Minimum 7d closed trades for expectancy reactions',
  20,
);
args.option(['X', 'minimumExpectancy'], 'Minimum acceptable 7d expectancy', 0);
args.option(['o', 'out'], 'Output JSON path', 'output/runtime-scorecard.json');
args.option(
  ['m', 'releaseManifest'],
  'Verified strategy release envelope JSON',
);
args.option(['D', 'diagnosisDays'], 'Equal-length release drawdown window', 7);
args.option(
  ['z', 'strategyReleaseRoot'],
  'Publish advisory diagnosis and immutable chart markers under this root',
);

const flags = args.parse(process.argv);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const resolveOptionalPath = (value: unknown) => {
  const raw = String(value ?? '').trim();
  return raw ? path.resolve(projectRoot, raw) : null;
};

const readJson = async (filePath: string | null) =>
  filePath
    ? (JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown)
    : undefined;

const assertReportType = (
  artifact: unknown,
  expected: string,
  label: string,
) => {
  if (
    artifact != null &&
    (!artifact ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      (artifact as Record<string, unknown>).reportType !== expected)
  ) {
    throw new Error(`${label} must be a ${expected} artifact`);
  }
};

const sha256File = async (filePath: string) =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex');

const loadHistoryArtifacts = async (historyDir: string | null) => {
  if (!historyDir) return [];
  const bundleDirs = await discoverRuntimeEvidenceBundles(historyDir);
  const bundles = [];
  for (const bundleDir of bundleDirs) {
    bundles.push(await verifyRuntimeEvidenceBundle(bundleDir));
  }
  return bundles.map((bundle) => bundle.artifact);
};

export const runtimeScorecard = async () => {
  const runtimeEvidencePath = resolveOptionalPath(flags.runtimeEvidence);
  if (!runtimeEvidencePath) {
    throw new Error('Provide --runtimeEvidence for the runtime scorecard.');
  }
  const replayEvidencePath = resolveOptionalPath(flags.replayEvidence);
  const calibrationPath = resolveOptionalPath(flags.calibration);
  const prospectiveEvidencePath = resolveOptionalPath(
    flags.prospectiveEvidence,
  );
  const historyDir = resolveOptionalPath(flags.historyDir);
  const releaseManifestPath = resolveOptionalPath(flags.releaseManifest);
  const [
    runtimeArtifact,
    replayEvidenceArtifact,
    calibrationArtifact,
    prospectiveEvidenceArtifact,
    history,
  ] = await Promise.all([
    readJson(runtimeEvidencePath),
    readJson(replayEvidencePath),
    readJson(calibrationPath),
    readJson(prospectiveEvidencePath),
    loadHistoryArtifacts(historyDir),
  ]);
  assertReportType(runtimeArtifact, 'runtime-evidence', 'runtimeEvidence');
  assertReportType(
    replayEvidenceArtifact,
    'replay-runtime-evidence',
    'replayEvidence',
  );
  assertReportType(calibrationArtifact, 'execution-calibration', 'calibration');
  assertReportType(
    prospectiveEvidenceArtifact,
    'strategy-prospective-evidence',
    'prospectiveEvidence',
  );
  const verifiedRelease = releaseManifestPath
    ? await verifyStrategyReleaseEnvelope(releaseManifestPath)
    : null;
  const requestedStrategy = String(flags.strategy ?? '').trim() || null;
  if (
    verifiedRelease &&
    requestedStrategy &&
    requestedStrategy !== verifiedRelease.manifest.strategy
  ) {
    throw new Error(
      `Requested strategy ${requestedStrategy} does not match release ${verifiedRelease.manifest.strategy}`,
    );
  }
  const scorecardStrategy =
    requestedStrategy ?? verifiedRelease?.manifest.strategy ?? null;
  const scorecard = buildRuntimeScorecard({
    runtimeArtifact,
    replayEvidenceArtifact,
    calibrationArtifact,
    prospectiveEvidenceArtifact,
    historyRuntimeArtifacts: history,
    thresholds: {
      minimumParityRatio: Number(flags.minimumParityRatio),
      maximumSlippageResidualBps: Number(flags.maximumSlippageResidualBps),
      maximumSignalCloseToSubmitMs: Number(flags.maximumSignalCloseToSubmitMs),
      minimumClosedTrades: Number(flags.minimumClosedTrades),
      minimumExpectancy: Number(flags.minimumExpectancy),
    },
    strategy: scorecardStrategy,
    llmComparatorPolicy:
      verifiedRelease?.manifest.prospective.llmComparatorPolicy ??
      'ai_approved_only',
  });
  const outPath = path.resolve(projectRoot, String(flags.out));
  const markdownPath = outPath.replace(/\.json$/i, '') + '.md';
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await Promise.all([
    fs.writeFile(outPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8'),
    fs.writeFile(
      markdownPath,
      formatRuntimeScorecardMarkdown(scorecard),
      'utf8',
    ),
  ]);

  const diagnosis = verifiedRelease
    ? buildStrategyLiveDiagnosisFromScorecard({
        manifest: verifiedRelease.manifest,
        scorecard,
        days: Number(flags.diagnosisDays),
      })
    : null;
  const diagnosisPath = diagnosis
    ? outPath.replace(/\.json$/i, '') + '.diagnosis.json'
    : null;
  const strategyReleaseRoot = resolveOptionalPath(flags.strategyReleaseRoot);
  if (diagnosis && diagnosisPath) {
    await fs.writeFile(
      diagnosisPath,
      `${JSON.stringify(diagnosis, null, 2)}\n`,
      'utf8',
    );
    if (strategyReleaseRoot) {
      const sourcePaths = [
        runtimeEvidencePath,
        replayEvidencePath,
        calibrationPath,
        prospectiveEvidencePath,
        releaseManifestPath,
        outPath,
      ].filter((value): value is string => Boolean(value));
      await publishStrategyLiveDiagnosis({
        rootDir: strategyReleaseRoot,
        diagnosis,
        composition: verifiedRelease?.manifest.composition,
        sourceArtifacts: await Promise.all(
          sourcePaths.map(async (sourcePath) => ({
            artifactId: path.basename(sourcePath),
            path: sourcePath,
            sha256: await sha256File(sourcePath),
          })),
        ),
      });
    }
  }

  let receiptPath: string | null = null;
  if (flags.markProcessed) {
    const runtimeEvidenceBundle = await verifyRuntimeEvidenceBundle(
      path.dirname(runtimeEvidencePath),
    );
    const feedbackSource = replayEvidencePath
      ? await verifyRuntimeFeedbackReplaySource({
          bundleDir: path.dirname(replayEvidencePath),
          runtimeEvidenceBundleDir: path.dirname(runtimeEvidencePath),
        }).catch((error) => {
          if (runtimeEvidenceBundle.artifact.producer) throw error;
          return null;
        })
      : null;
    if (runtimeEvidenceBundle.artifact.producer && !feedbackSource) {
      throw new Error(
        'Image-bound runtime evidence requires a verified production replay bundle before it can be marked processed',
      );
    }
    receiptPath = await markRuntimeEvidenceBundleProcessed({
      evidenceRoot: path.resolve(projectRoot, String(flags.evidenceDir)),
      deploymentId: String(flags.deployment),
      bundleDir: path.dirname(runtimeEvidencePath),
      scorecardPath: outPath,
      runtimeFeedback: feedbackSource
        ? {
            artifactId: feedbackSource.feedback.manifest.artifactId,
            replayEvidenceSha256:
              feedbackSource.feedback.manifest.payloads.replayEvidence.sha256,
          }
        : null,
    });
  }

  console.log(chalk.green(`Wrote ${outPath}`));
  console.log(chalk.green(`Wrote ${markdownPath}`));
  console.log(
    JSON.stringify(
      {
        promotionStatus: scorecard.promotionStatus,
        funnel: scorecard.funnel,
        parity: scorecard.parity,
        execution: scorecard.execution,
        rolling: scorecard.rolling,
        reactions: scorecard.reactions,
        receiptPath,
        diagnosisPath,
        diagnosisVerdict: diagnosis?.verdict ?? null,
      },
      null,
      2,
    ),
  );
};

export const main = runtimeScorecard;
