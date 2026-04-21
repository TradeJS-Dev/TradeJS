# TradeJS Quickstart

## 1. Prerequisites

- Node.js `20.19.6` (from `.nvmrc`)
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

User profile settings are stored in Redis under the user record and now include:

- `BYBIT_API_KEY`
- `BYBIT_API_SECRET`
- passwordless auth `token`
- `OPENAI_API_KEY`
- `OPENAI_API_ENDPOINT`
- `TG_BOT_TOKEN`
- `TG_CHAT_ID`

Use the drawer to:

- rotate Bybit credentials
- change the password
- rotate the passwordless auth token
- set per-user OpenAI provider settings
- set per-user Telegram bot delivery settings

## 7. Run Basic CLI Flows

```bash
yarn build:ci
yarn backtest
yarn backtest -- --days 3 --config TrendLine:prod
yarn results
yarn signals
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
- production cron runs `signals --notify --makeOrders` every 15 minutes
- signals with `orderStatus=skipped` or `orderStatus=canceled` are not sent to Telegram anymore
- deliverable signals are sent one by one so the main signal message stays grouped with its optional AI analysis message
- the main signal message tries to send a screenshot with caption first; if photo delivery fails, TradeJS falls back to a text message
- if AI analysis exists for the signal, it is sent as a separate follow-up Telegram message

Daily summary:

- `yarn signals:summary` builds a Telegram digest for the last 24 hours
- production cron sends it every day at `23:00` in `Europe/Moscow` timezone
- summary includes per-strategy signal counts by status, plus per-strategy trade counts, active/closed status, and current/closed PnL
- runtime trade linking uses generated `orderId`; for Bybit it is passed through as `orderLinkId`

Useful manual checks:

```bash
yarn signals -- --notify --user root --connector bybit
yarn signals:summary -- --user root --connector bybit --printOnly
yarn runtime-parity -- --user root --connector bybit --days 3 --details
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

Or run a predefined model script:

```bash
yarn ml-train:trendline:xgboost
```

AI offline replay flow:

```bash
yarn backtest --AI
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
