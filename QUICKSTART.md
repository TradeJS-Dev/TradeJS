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

Open `http://localhost:3000`.

Useful routes:

- `http://localhost:3000/routes/backtest` — saved backtest runs and detail pages
- `http://localhost:3000/routes/dashboard` — chart view for signals and market inspection

Single command alternative:

```bash
yarn dev:with-infra
```

## 5. Run Basic CLI Flows

```bash
yarn backtest
yarn results
yarn signals
yarn bot
```

## 6. Data Maintenance

Refresh history:

```bash
yarn update-history -- --user root --config TrendLine:base --connector bybit --timeframe 15
```

Continuity check/repair:

```bash
yarn continuity --user root --timeframe 15 --provider bybit
```

## 7. ML (Optional)

```bash
yarn ml-export
yarn ml-train:latest
```

Or run a predefined model script:

```bash
yarn ml-train:trendline:xgboost
```

## 8. Sandbox Plugin Mode (Framework Check)

`examples/sandbox` contains a full deterministic app-style e2e flow with:

- local `tradejs.config.ts`
- custom strategy, indicator and connector plugins
- seeded user/config and stable backtest + signals snapshot assertions

```bash
yarn sandbox:refresh # optional after publishing newer @tradejs/* versions
yarn sandbox:install
yarn sandbox:infra-up
yarn sandbox:e2e
yarn sandbox:infra-down
```

## Import Rule For Plugins

- Use `@tradejs/core/config` for plugin registration.
- Use public `@tradejs/core/*` subpaths for browser-safe helpers.
- Use public `@tradejs/node/*` subpaths for Node runtime wiring.
- Use `@tradejs/types` for shared contracts.
- Avoid non-public deep imports like `@tradejs/core/src/*` or `@tradejs/node/src/*`.

## 9. Stop Infrastructure

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
yarn dev-tsc
yarn unit
```

### Strategy API contract reference

See root strategy contract doc:

- `STRATEGY_API.md`
