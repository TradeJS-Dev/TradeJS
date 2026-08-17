import args from 'args';
import { AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS } from '../lib/aiPocketSearchCli';
import { runAiPocketSearchCommand } from '../lib/aiPocketSearch/command';

args.example(
  'yarn ai-pocket-search --strategy LiquidityZones -n 0 --maxDepth 2 --minSupport 25',
  'Search deterministic AI-gate pockets over the latest LiquidityZones AI export',
);

args.option(['o', 'outDir'], 'Dataset directory', 'data/ai/export');
args.option(['s', 'strategy'], 'Strategy name filter for merged file', '');
args.option(['f', 'file'], 'Explicit merged dataset file path', '');
args.option(
  ['n', 'recent'],
  'How many recent trades to evaluate from the end (0 = all)',
  50,
);
args.option(
  ['k', 'skip'],
  'How many recent trades to skip from the end before selecting replay rows',
  0,
);
args.option(
  ['M', 'minQuality'],
  'Minimum deterministic gate quality used for current qN+ baseline',
  4,
);
args.option(
  ['S', 'since'],
  'Only evaluate rows at or after this timestamp (ISO date or epoch ms)',
  '',
);
args.option(
  ['u', 'until'],
  'Only evaluate rows at or before this timestamp (ISO date or epoch ms)',
  '',
);
args.option(
  ['P', 'period'],
  'Evaluate a trailing selected-row period such as last365d, last90d, or last30d',
  '',
);
args.option(
  ['q', 'qualityThresholds'],
  'Comma-separated qN+ thresholds for current-gate baseline',
  '3,4,5',
);
args.option(
  ['g', 'scope'],
  'Search scope: all, approved, rejected, or candidates',
  'all',
);
args.option(
  ['I', 'direction'],
  'Only search rows with this signal direction: LONG or SHORT',
  '',
);
args.option(['d', 'maxDepth'], 'Maximum predicate-combination depth', 2);
args.option(
  ['m', 'minSupport'],
  'Minimum rows override; cadence auto derives it when omitted',
  20,
);
args.option(
  ['F', 'minProfitFactor'],
  'Minimum profit factor required for positive pockets',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.minProfitFactor,
);
args.option(
  ['W', 'minWinRate'],
  'Minimum win rate required for positive pockets',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.minWinRate,
);
args.option(
  ['R', 'minTotalProfit'],
  'Minimum total PnL required for positive pockets',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.minTotalProfit,
);
args.option(
  ['a', 'maxAtomicPredicates'],
  'Maximum strongest atomic predicates used for combinations',
  180,
);
args.option(
  ['C', 'maxCombinations'],
  'Maximum predicate combinations to evaluate',
  60000,
);
args.option(
  ['V', 'validationSplit'],
  'Trailing time-ordered scope share reserved for validation (0 disables)',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.validationSplit,
);
args.option(
  ['T', 'testSplit'],
  'Trailing timestamp-grouped scope share withheld as untouched test',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.testSplit,
);
args.option(
  ['w', 'sealTest'],
  'Reserve test bounds without exposing its rows or economics to discovery',
  false,
);
args.option(
  ['N', 'minValidationSupport'],
  'Minimum validation rows required for positive pockets (0 = auto)',
  0,
);
args.option(
  ['H', 'minEvents'],
  'Minimum independent timestamp events required (0 = auto)',
  0,
);
args.option(
  ['J', 'minValidationEvents'],
  'Minimum validation timestamp events required (0 = auto)',
  0,
);
args.option(
  ['X', 'maxBatch'],
  'Maximum selected rows at one timestamp (0 disables)',
  5,
);
args.option(
  ['U', 'maxEventCountShare'],
  'Maximum row share contributed by one timestamp event',
  '0.25',
);
args.option(
  ['Z', 'maxSymbolCountShare'],
  'Maximum row share contributed by one symbol',
  '0.5',
);
args.option(
  ['A', 'objective'],
  'Search objective: auto, standalone, add-to-gate, or filter-gate',
  'auto',
);
args.option(
  ['G', 'allowRiskRegression'],
  'Allow incremental pockets to worsen q4+ PF, PnL, drawdown, or loss streak',
  false,
);
args.option(
  ['L', 'allowValidationRegression'],
  'Keep train-positive pockets that fail validation PnL/PF thresholds',
  false,
);
args.option(
  ['D', 'dedupeEquivalentSelections'],
  'Collapse pockets that select the same train rows',
  true,
);
args.option(['t', 'top'], 'Top pockets to print in each section', 30);
args.option(['Y', 'includeSymbol'], 'Allow symbol as a pocket feature', false);
args.option(
  ['E', 'includeGateContext'],
  'Allow current deterministic gate output fields as pocket features',
  false,
);
args.option(
  ['p', 'featureProfile'],
  'Feature extraction profile: compact or all',
  'all',
);
args.option(
  ['K', 'featurePolicy'],
  'Feature policy: causal-stationary or all',
  'causal-stationary',
);
args.option(
  ['Q', 'coverageMode'],
  'Coverage-aware search mode: auto or full',
  'auto',
);
args.option(
  ['c', 'cadenceMode'],
  'Cadence thresholds: auto adapts discovery support, fixed keeps legacy defaults',
  'auto',
);
args.option(
  ['r', 'reportDir'],
  'Directory for generated Markdown reports',
  'data/ai/output',
);
args.option(['B', 'reportFile'], 'Explicit Markdown report file path', '');
args.option(['j', 'json'], 'Print structured JSON summary', false);
args.option(['O', 'output'], 'Write structured JSON summary to file', '');

const flags = args.parse(process.argv);

export const main = () => runAiPocketSearchCommand({ flags });
