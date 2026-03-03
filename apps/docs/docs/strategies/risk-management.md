---
title: Risk Management Patterns
---

Risk controls should be explicit and testable.

## Position Sizing

- Use fixed risk per trade, not only fixed quantity.
- Calculate quantity from stop distance and max loss budget.

## Exposure Limits

- Max concurrent positions per strategy.
- Max directional exposure across correlated symbols.

## Cooldown and Frequency

- Introduce a cooldown after exits.
- Limit new entries per time window.

## Execution Guardrails

- Require valid stop-loss for each entry.
- Block orders during dependency outages.
- Disable live execution quickly via config switch.

## Review Cycle

- Re-evaluate limits after volatility regime changes.
- Keep a changelog for risk parameter updates.
