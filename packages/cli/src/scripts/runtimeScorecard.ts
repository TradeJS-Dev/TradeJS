import fs from 'node:fs/promises';
import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import {
  discoverRuntimeEvidenceBundles,
  verifyRuntimeEvidenceBundle,
} from '../lib/runtimeEvidenceArtifacts';
import { markRuntimeEvidenceBundleProcessed } from '../lib/runtimeEvidenceSync';
import {
  buildRuntimeScorecard,
  formatRuntimeScorecardMarkdown,
} from '../lib/runtimeScorecard';

args.option('runtimeEvidence', 'Verified runtime evidence JSON');
args.option('replayEvidence', 'Replay runtime evidence JSON');
args.option('calibration', 'Execution calibration JSON');
args.option('historyDir', 'Directory containing verified evidence bundles');
args.option(
  'evidenceDir',
  'Local evidence storage root used for processing receipts',
  process.env.RUNTIME_EVIDENCE_LOCAL_DIR || 'data/runtime-evidence',
);
args.option(
  'deployment',
  'Deployment id used for processing receipts',
  process.env.RUNTIME_EVIDENCE_DEPLOYMENT_ID || 'production',
);
args.option('markProcessed', 'Write a processing receipt on success', false);
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
  ['T', 'minimumClosedTrades'],
  'Minimum 7d closed trades for expectancy reactions',
  20,
);
args.option(['X', 'minimumExpectancy'], 'Minimum acceptable 7d expectancy', 0);
args.option(['o', 'out'], 'Output JSON path', 'output/runtime-scorecard.json');

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
  const historyDir = resolveOptionalPath(flags.historyDir);
  const [
    runtimeArtifact,
    replayEvidenceArtifact,
    calibrationArtifact,
    history,
  ] = await Promise.all([
    readJson(runtimeEvidencePath),
    readJson(replayEvidencePath),
    readJson(calibrationPath),
    loadHistoryArtifacts(historyDir),
  ]);
  const scorecard = buildRuntimeScorecard({
    runtimeArtifact,
    replayEvidenceArtifact,
    calibrationArtifact,
    historyRuntimeArtifacts: history,
    thresholds: {
      minimumParityRatio: Number(flags.minimumParityRatio),
      maximumSlippageResidualBps: Number(flags.maximumSlippageResidualBps),
      minimumClosedTrades: Number(flags.minimumClosedTrades),
      minimumExpectancy: Number(flags.minimumExpectancy),
    },
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

  let receiptPath: string | null = null;
  if (flags.markProcessed) {
    receiptPath = await markRuntimeEvidenceBundleProcessed({
      evidenceRoot: path.resolve(projectRoot, String(flags.evidenceDir)),
      deploymentId: String(flags.deployment),
      bundleDir: path.dirname(runtimeEvidencePath),
      scorecardPath: outPath,
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
      },
      null,
      2,
    ),
  );
};

export const main = runtimeScorecard;
