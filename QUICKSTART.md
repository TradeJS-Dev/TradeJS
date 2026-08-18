# TradeJS Quickstart

Use this monorepo for framework development and package verification. Run the
personal app, infrastructure, backtest, replay, AI, and research workflows from
`~/dev/tradejs/tradejs-project`; that project owns `.env`,
`tradejs.config.ts`, `data/`, `notes/`, and local Compose.

## 1. Prerequisites

- Node.js `24.17.0` (from `.nvmrc`)
- Yarn `4.x` (`corepack enable`)
- Docker + Docker Compose

## 2. Install Dependencies

```bash
corepack enable
nvm use
yarn
```

## 3. Start Infrastructure

```bash
yarn infra-up
yarn doctor
```

Services:

- TimescaleDB (`127.0.0.1:5432`)
- Redis (`127.0.0.1:6379`)

## 4. Run the App

```bash
yarn dev
```

Open the local URL printed by Next.js (`http://localhost:3000` by default).

Useful routes:

- `http://localhost:3000/routes/backtest` — saved backtest runs and detail pages
- `http://localhost:3000/routes/dashboard` — chart view for signals and market inspection

Single command alternative:

```bash
yarn dev:with-infra
```

## 5. Create Or Update A Local User

```bash
yarn user-add -u root -p 'StrongPassword123!'
```

Use the created credentials on `/routes/signin`.

## 6. Configure Account Settings In The UI

After sign in, open the gear icon in the left sidebar.

Exchange credentials are stored only in canonical trading-account records.
Create a Bybit account in the **Trading accounts** section and bind its id to a
runtime deployment. User profile settings contain shared service settings,
including:

- `AI_API_KEY`
- `AI_API_ENDPOINT`
- `TG_BOT_TOKEN`
- `TG_CHAT_ID`

Use the drawer to:

- create, rotate, disable, and select trading accounts
- change the password
- set per-user OpenAI provider settings
- set per-user Telegram bot delivery settings

## 7. Run Basic CLI Flows

```bash
yarn build:ci
yarn backtest
yarn backtest -- --days 3 --config TrendLine:prod
yarn results
yarn signals -- --deployment <deployment-id>
yarn signals:daemon -- --deployment <deployment-id>
yarn signals:summary -- --printOnly
yarn runtime-parity -- --days 3
yarn bot
```

## Telegram Notifications

Telegram delivery uses per-user settings from the account drawer:

- `TG_BOT_TOKEN`
- `TG_CHAT_ID`

Runtime signal delivery:

- `yarn signals -- --notify` sends Telegram messages for runtime signals
- production runtime runs `yarn signals:daemon -- --notify --makeOrders`; `yarn signals` remains the one-shot manual and recovery command
- Bybit candle streaming is enabled automatically in `signals:daemon`; REST only fills startup/reconnect gaps. Use `SIGNALS_KLINE_WS_ENABLED=0` to roll back to the previous REST-only cycle.
- the production app entrypoint also supervises `yarn market:ws`, which serves dashboard live candles on port `3001` through the deployment proxy path `/ws/market`
- signals with `orderStatus=skipped` or `orderStatus=canceled` are not sent to Telegram anymore
- deliverable signals are sent one by one so the main signal message stays grouped with its optional AI analysis message
- the main signal message tries to send a screenshot with caption first; if photo delivery fails, TradeJS falls back to a text message
- if AI analysis exists for the signal, it is sent as a separate follow-up Telegram message

Summary reports:

- `yarn signals:summary` builds a Telegram digest for the last 24 hours
- production cron sends the daily report every day at `21:00` in `Europe/Moscow` timezone
- production cron publishes immutable runtime evidence every day at `21:05` in `Europe/Moscow` timezone
- production cron runs runtime parity every day at `21:10` in `Europe/Moscow` timezone
- production cron sends the weekly report on Sundays at `22:10` in `Europe/Moscow` timezone using `--hours 168`
- production cron runs nightly research every day at `00:00` in `Europe/Moscow` timezone:

```cron
CRON_TZ=Europe/Moscow
0 0 * * * cd /Users/aleksnick/dev/tradejs/tradejs-project && /usr/bin/env bash -lc 'yarn research:auto -- --user root --connector bybit --timeframe 15 --days 45 --recent 1000'
```

- `yarn research:auto` picks the strategy with the oldest missing/stale research run, snapshots the current strategy config into backtest config `<Strategy>:research`, runs `clean-tests -> clean-dir --dir ai/export -> backtest --ai -> ai-export -> ai-train --localOnly`, stores the structured run in Redis, always sends a Telegram report, and then directly invokes `yarn agent-run`
- `yarn agent-run` requires `AI_API_ENDPOINT` to point to OpenRouter and uses `openai/gpt-5.4` with `reasoning.effort=medium`
- the agent checks out the owning source repository under the project's ignored
  `data/cache/research-agent-checkouts/`, creates a separate review branch under
  `codex/research/*`, validates with that repository's `yarn checks`, pushes the
  branch, and sends a dedicated Telegram report
- in production the nightly research job runs inside the separate `agent` container, not the main `app` container
- hosted deploy wiring for the production `agent` container now lives in the separate `TradeJS-Deploy` repository, not in this monorepo quickstart
- required runtime user settings in Redis for `root`:
  - `AI_API_ENDPOINT=https://openrouter.ai/api/v1`
  - `AI_API_KEY=<OpenRouter key>`
  - `TG_BOT_TOKEN`
  - `TG_CHAT_ID`
- summary includes per-strategy signal counts by status, plus per-strategy trade counts, active/closed status, and current/closed PnL
- runtime trade linking uses generated `orderId`; for Bybit it is passed through as `orderLinkId`

Useful manual checks:

```bash
yarn signals -- --notify --user root --deployment <deployment-id>
yarn signals:daemon -- --notify --makeOrders --user root --deployment <deployment-id>
yarn signals:summary -- --user root --connector bybit --printOnly
yarn runtime-parity -- --user root --connector bybit --days 3 --details
```

Runtime feedback artifacts:

- the runtime server publishes the latest complete `21:00 MSK -> 21:00 MSK` window into an immutable bundle under `incoming/` and atomically moves it to `ready/`
- each ready bundle contains `runtime-evidence.json`, `manifest.json`, and `.complete`; consumers verify the payload size and SHA-256 before processing
- closed trades are indexed by their exit day, so a trade opened on an earlier day still appears in the artifact for the day it closes

```bash
RUNTIME_EVIDENCE_PUBLISH_DIR=/app/data/runtime-evidence \
RUNTIME_EVIDENCE_DEPLOYMENT_ID=production \
yarn runtime:evidence:publish -- --user root
```

The local checkout can use the existing SSH account while the dedicated
read-only evidence account is not configured yet:

```bash
RUNTIME_EVIDENCE_RSYNC_SOURCE='inv:/root/data/runtime-evidence/ready/production/' \
RUNTIME_EVIDENCE_DEPLOYMENT_ID=production \
yarn runtime:evidence:sync
```

The sync command never deletes remote artifacts. It downloads into
`data/runtime-evidence/inbox`, verifies completed bundles, moves them to
`data/runtime-evidence/artifacts`, and reports every artifact without a local
processing receipt. After replay and calibration, build the daily scorecard and
write the receipt only on successful completion:

```bash
yarn replay -- \
  --user root \
  --connector bybit \
  --cacheOnly \
  --startTime <window.startTime> \
  --endTime <window.endTime> \
  --runtimeEvidence <bundle>/runtime-evidence.json
yarn replay:evidence -- \
  --user root \
  --runtimeEvidence <bundle>/runtime-evidence.json \
  --startTime <window.startTime> \
  --endTime <window.endTime> \
  --out output/replay-runtime-evidence.json
yarn cli:node8g execution-calibration \
  --runtimeEvidence <bundle>/runtime-evidence.json \
  --replayEvidence output/replay-runtime-evidence.json \
  --out output/execution-calibration.json
yarn runtime:scorecard -- \
  --runtimeEvidence <bundle>/runtime-evidence.json \
  --replayEvidence output/replay-runtime-evidence.json \
  --calibration output/execution-calibration.json \
  --historyDir data/runtime-evidence/artifacts/production \
  --markProcessed
```

Runtime/backtest parity:

- `yarn runtime-parity` replays recent history with the effective runtime config (`user strategy config` + per-symbol `results` patch) in `BACKTEST` mode and compares backtest entries against saved runtime trade records.
- matching is done by `strategy + symbol + direction + timestamp` with configurable tolerance in bars; entry price is reported as drift only, not used as the primary match key.
- if a strategy enables AI/ML gates, the command warns that standard `BACKTEST` replay covers core execution parity, not live gating parity.

## 8. Data Maintenance

Refresh history:

```bash
yarn update-history -- --user root --config TrendLine:base --connector bybit --timeframe 15
yarn backtest -- --user root --config TrendLine:prod --days 3 --connector bybit
```

Continuity check/repair:

```bash
yarn continuity --user root --timeframe 15 --provider bybit
```

## 9. ML / AI (Optional)

ML dataset flow:

```bash
yarn ml-export
yarn ml-train:latest
```

Select the strategy and model explicitly:

```bash
yarn ml-train:latest -- --strategy TrendLine --model xgboost
```

AI offline replay flow:

```bash
yarn backtest --ai
yarn ai-export
yarn ai-train -n 50 --minQuality 4
```

`yarn ai-train` replays saved prompts from the merged dataset, evaluates the latest trades from the end, and treats `-n 0` as "check all rows".

## 10. Sandbox Plugin Mode (Framework Check)

`examples/sandbox` contains a full deterministic app-style e2e flow with:

- local `tradejs.config.ts`
- custom strategy, indicator and connector plugins
- seeded user/config and stable backtest + signals snapshot assertions

```bash
yarn sandbox:install
yarn sandbox:infra-up
yarn sandbox:e2e
yarn sandbox:infra-down
```

`yarn sandbox:install` installs `examples/sandbox` deterministically from its
committed lockfile.

Beta validation updates the sandbox's direct `@tradejs/*` versions and lockfile,
then runs this e2e flow against the exact registry prerelease before it may
receive the npm `beta` tag. Stable packages are promoted only by the weekly
automation.

Use `yarn sandbox:refresh` only when you intentionally want to update the
published `@tradejs/*` versions used by the sandbox.

## Import Rule For Plugins

- Use `@tradejs/core/config` for plugin registration.
- Use public `@tradejs/core/*` subpaths for browser-safe helpers.
- Use public `@tradejs/node/*` subpaths for Node runtime wiring.
- Use `@tradejs/types` for shared contracts.
- Avoid non-public deep imports like `@tradejs/core/src/*` or `@tradejs/node/src/*`.

## 11. Stop Infrastructure

```bash
yarn infra-down
```

## Troubleshooting

### Release smoke check

The beta workflow first publishes an exact prerelease under the temporary
`beta-candidate` tag, then runs the browser quickstart, standalone sandbox, and
the production-like `TradeJS-Project` image against packages downloaded from
npm. The Project smoke starts isolated Redis and Timescale containers, provisions
two immutable DoubleTap releases, verifies the minimal deployment reference and
absence of the legacy mutable config key, and probes both app and market-ws
health. Only then does the candidate receive the `beta` tag.

### `ECONNREFUSED` for `5432` or `6379`

```bash
yarn infra-up
yarn doctor
```

### Type/Test checks after core changes

```bash
yarn build:ci
yarn typecheck
yarn unit
```

### Strategy API contract reference

See root strategy contract doc:

- `STRATEGY_API.md`
