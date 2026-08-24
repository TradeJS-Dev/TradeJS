---
name: strategy-release
description: Deprecated compatibility entrypoint for the former monolithic TradeJS strategy workflow. Use a focused strategy-candidate, strategy-improvement, strategy-period, strategy-forward, or strategy-risk skill instead.
---

# Strategy Release (Deprecated)

Do not run the former all-in-one research and production contour. Route the
request to exactly one focused skill:

- latest selected metrics: `$strategy-candidate-report`;
- candidate versus production: `$strategy-candidate-compare`;
- improvement analysis only: `$strategy-improvement-plan`;
- new core + deterministic-gate research: `$strategy-improvement-research`;
- frozen candidates on a new period: `$strategy-period-revalidate`;
- start or replace a risk-1 forward test: `$strategy-forward-start`;
- inspect a running forward test: `$strategy-forward-status`;
- increase only `MAX_LOSS_VALUE`: `$strategy-risk-scale`.

Never combine research, candidate selection, publication, deployment, and risk
scaling merely because this legacy name was invoked. Ask for the intended
focused action only when it cannot be inferred from the user’s wording.
