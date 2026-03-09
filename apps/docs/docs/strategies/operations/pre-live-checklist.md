---
title: Pre-Live Strategy Checklist
---

Run this checklist before enabling `--makeOrders`.

## Strategy Quality

- Backtest coverage is sufficient across market regimes.
- Results include realistic assumptions (fees/slippage).
- No obvious overfitting to one period.

## Runtime Readiness

- Strategy config is loaded and validated.
- AI/ML runtime policy is intentional, not default by accident.
- Stop-loss and take-profit logic is verified.

## Infrastructure Readiness

- `npx @tradejs/cli doctor` passes required checks.
- Redis and Postgres are stable.
- ML inference endpoint is reachable if required.

## Safety Readiness

- Exposure limits are configured.
- Rollback plan is documented.
- Alerting is enabled for critical failures.
