---
title: Use Backtest Results In Runtime
---

This page explains how to promote positive backtest configs into runtime, how `npx @tradejs/cli results` works, and how `isConfigFromBacktest` is set.

## 1. What `npx @tradejs/cli results` Does

`npx @tradejs/cli results` scans saved test configs/stats and builds per-symbol winners for one strategy.

Main command:

```bash
npx @tradejs/cli results --strategy TrendLine --coverage --user root
```

Useful modes:

- `--update`: overwrite saved strategy results with current winners
- `--merge`: update only symbols where new profit is better than saved one
- `--clear`: remove saved promoted results

Examples:

```bash
npx @tradejs/cli results --strategy TrendLine --merge --user root
npx @tradejs/cli results --strategy TrendLine --update --user root
npx @tradejs/cli results --strategy TrendLine --clear --user root
```

## 2. Where Promoted Config Is Stored

Promoted per-symbol config is stored in:

- `users:<user>:strategies:<strategy>:results`

Each symbol entry contains:

- `config` (strategy config for that symbol)
- `stats` (backtest metrics)

## 3. Runtime Config Precedence

Runtime config is resolved in this order (`resolveStrategyConfig`):

1. strategy defaults (`strategy/<Strategy>/config.ts`)
2. base config passed to strategy creator
3. user runtime config (`users:<user>:strategies:<strategy>:config`)
4. promoted per-symbol result from `users:<user>:strategies:<strategy>:results`

When step 4 applies, runtime marks:

- `isConfigFromBacktest = true`

## 4. How `isConfigFromBacktest` Is Used

`isConfigFromBacktest` is written into signal payload and can be used in UI/Telegram/debug flows.

Runtime behavior:

- if symbol has promoted result config: signal shows `isConfigFromBacktest: true`
- if no symbol entry exists: runtime uses base/user config and `isConfigFromBacktest: false`

## 5. Recommended Workflow

1. Run backtests for a strategy config grid.
2. Run `npx @tradejs/cli results --strategy <Strategy> --coverage` to inspect winners.
3. Promote with `--merge` first (safer than full overwrite).
4. Run `npx @tradejs/cli signals` / `npx @tradejs/cli bot` and verify signals with `isConfigFromBacktest=true`.
5. Re-run promotion periodically after new backtests.

## 6. Notes

- `--coverage` currently uses ByBit ticker universe for coverage denominator.
- `--merge` keeps previously promoted symbols unless a better profit is found.
