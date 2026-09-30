# @tradejs/cli

Official CLI for the TradeJS TypeScript framework.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- CLI API docs: https://docs.tradejs.dev/api/cli
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## License

Version 2.0.0 and later is licensed under Business Source License 1.1. The
Additional Use Grant permits internal and other non-competing production use;
providing a competing product or service requires a commercial license.
Earlier releases remain MIT-licensed. See the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## Where It Fits

`@tradejs/cli` is the operational entrypoint for the standard external TradeJS project flow:

- initialize local infra files
- start/stop Redis + PostgreSQL/Timescale
- verify runtime dependencies
- create users
- run backtests, signals, bots, and AI/ML workflows

## Standard External Install Flow

For a new external project with CLI + runtime + UI:

```bash
npx create-tradejs
```

The generator installs the packages, starts local infra, and opens the install
page. The user chooses the local `root` password before entering the dashboard.

For manual integration into an existing project:

```bash
npm i @tradejs/app @tradejs/core @tradejs/node @tradejs/types @tradejs/base @tradejs/cli
```

Add `tradejs.config.ts` in project root:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset);
```

## Manual Setup Commands

```bash
npx @tradejs/cli infra-init
npx @tradejs/cli infra-up
npx @tradejs/cli doctor
npx @tradejs/cli user-add -u root -p 'StrongPassword123!'
```

After saving a backtest config, you can run:

```bash
npx @tradejs/cli backtest --config MaStrategy:base
npx @tradejs/cli backtest --ai
npx @tradejs/cli ai-export
npx @tradejs/cli ai-train -n 50 --minQuality 4
npx @tradejs/cli signals
npx @tradejs/cli results
npx @tradejs/cli bot
```

And start the UI separately:

```bash
npx tradejs-app dev
```

## Notes

### Jev signal assessment (next package release)

This workflow requires the CLI, runtime and app versions containing the Jev
integration; it is not available in earlier published versions. In Account
settings, open **Jev**, choose OpenRouter, TypeSafe or a custom Decisions API,
and save its key, full decision endpoint and versioned model. These credentials
are separate from AI / LLM settings. A chat-completions endpoint is not supported.

Run commands from your generated project's root. Start with a bounded historical
window and one strategy configuration:

```bash
# Enrich signals with Jev. Calls the provider for missing recordings.
yarn exec tradejs backtest -c TrendFollow:base -d 30 --cacheOnly --jev

# Repeat with recorded answers only. Missing answers fail the run.
yarn exec tradejs backtest -c TrendFollow:base -d 30 --cacheOnly --jev --jevRecorded
```

Without `--jev`, ordinary backtests do not evaluate Jev, even if a configuration
contains `JEV`. `--jev` also enables the completed-trade AI export and records
all evaluated candidates, including candidates rejected by later policy.
Jev asks only the questions supported by available facts. The shared projection
selects a few signal-time trend, swing, volume, delta, entry-distance and
extension facts. It does not send the whole `baseContext`, raw figure points,
calculated gate scores, or outcome fields. The normalized answers are stored in
`signal.assessment` and the compact `additionalIndicators.jev` feature group,
which is available to the strategy's AI gate and AI export. Jev scores do not
approve or reject entries. With `AI_MODE=gate` and `AI_ENABLED=true`, a Jev
backtest applies the strategy's AI gate to entries; ordinary backtests keep
their existing entry behavior.

Any strategy can optionally attach `jevEvidence` through its `StrategyAPI.entry`
`additionalIndicators` with a version, `knownAt` timestamp, up to 16 scalar
setup facts and 16 scalar geometry facts:

```ts
additionalIndicators: {
  jevEvidence: {
    version: 'setup-v1',
    knownAt: timestamp,
    facts: { confirmationCount: 2, entryExtensionAtr: 0.4 },
    geometry: { normalizedWidthAtr: 1.5 },
  },
},
```

This is a strategy-neutral contract. Geometry is asked only when the strategy
supplies geometry facts; no strategy name is hard-coded in Jev. Invalid or
future-dated evidence fails validation.

The default minimum score is `0.5` per dimension. A strategy configuration may
set `JEV.minScores` and `JEV.requireGeometry`; backtests preserve those policy
fields when `--jev` selects the evaluator. Absent optional geometry is skipped;
invalid geometry and invalid trade levels cannot be approved. If no question has
enough facts, the assessment is unavailable and gate mode rejects the entry.
These are assessment scores, not calibrated probabilities of profitable trades.

Provider responses and decisions are saved under `data/ai/jev`, or the directory
selected with `--jevRecordsDir`. Input, selected question version and provider
identity determine each signal record. Equivalent facts reuse one provider
response even when signal timestamps or symbols differ. Existing v1 records and
local models are incompatible with the v2 contract.
Using identical date bounds is essential for reproducible comparisons. Filtering
entries may change subsequent strategy state, so an observe run does not
necessarily contain every candidate required by a gated run.

Train a local deterministic gate from the recorded teacher answers:

```bash
yarn exec tradejs jev --action export --strategy TrendFollow --out data/ai/jev/study.jsonl
yarn exec tradejs jev --action train --input data/ai/jev/study.jsonl --out data/ai/jev/gate.json
yarn exec tradejs jev --action compare --input data/ai/jev/study.jsonl --model data/ai/jev/gate.json --out data/ai/jev/comparison.json
yarn exec tradejs backtest -c TrendFollow:base -d 30 --cacheOnly --jev --jevModelFile data/ai/jev/gate.json
```

`export --input <completed-ai-export.jsonl>` optionally joins completed outcomes
by their exact assessment record id. Rejected candidates still provide teacher
labels, but have no observed trade outcome. Do not treat missing outcomes as
losses. `evaluate --input <ai-export.jsonl>` evaluates existing signal snapshots;
delayed-execution exports require the original Jev recording because their
prices have already changed after admission. Use a new output path for each run.

Training fits shallow trees to Jev scores, without trade outcomes as features or
labels. It requires at least 30 samples across 10 distinct signal times, selects
one strategy and one teacher/provider lineage, and separates train/validation/test
chronologically as 60/20/20. Three additional expanding-window folds check later
periods with independently fitted trees. The report measures teacher agreement, score error
and matched-outcome economics. These summaries are not sequential portfolio
backtests and do not establish profitability. Validate a frozen gate on a later
period with `--jevModelFile` before runtime use. Studies are bounded to 20,000
rows; `--maxDepth` and `--minLeaf` control rule complexity.

For runtime, put `JEV` inside the strategy's Git-owned `config` declaration:

```ts
JEV: {
  source: 'local',
  mode: 'observe',
  modelFile: 'data/ai/jev/gate.json',
  modelSha256: '<SHA-256 printed by jev --action train>',
}
```

Distribute the exact model file with the deployment. Provider runtime uses
`source: 'provider'`, a pinned `provider: { endpoint, model }`, and the account's
Jev key instead of the two model-file fields. Only `mode: 'observe'` is
supported: Jev enriches the signal and the configured AI gate decides entry.
A provider failure marks Jev unavailable in runtime; an incomplete backtest
fails so its research sample stays complete. Recorded mode never calls the
provider. Enabling Jev does not enable order placement.

- `@tradejs/cli` expects project wiring from `tradejs.config.ts` via `@tradejs/core/config`.
- Local infrastructure is created through `infra-init` and started through `infra-up`.
- Use `npx @tradejs/cli <command> --help` for command-specific flags.

Keywords: ai, claude, codex.
