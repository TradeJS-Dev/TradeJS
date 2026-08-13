# AI-gate reporting contract

Use this contract for every user-facing AI-gate metrics report and every dated
AI-gate notes entry. The goal is that repeated runs remain directly comparable.

## Contents

1. Chat report contract
2. Metric definitions
3. Formatting rules
4. Notes contract

## Chat report contract

Use the exact section order and column names below. Do not replace required
tables with prose. Use `current` for a single gate, `before` / `after` for a
change, and `baseline` / `pocket-only` / `final` for an ablation.

An explicitly narrow question such as "what is 7d cadence?" may receive a
narrow answer. Otherwise, use the full contract.

Reserve metric tables for the final report. Intermediate progress updates
should describe status without ad hoc metric summaries unless the user
explicitly asks for preliminary numbers.

### 1. Header and lineage

```md
## <Strategy> — AI gate report (`qN+`)

Decision: `<implement|observe|research-only|rollback|blocked>` — <one sentence>.

Dataset: `<merge_id>` (`<part_count>` parts), rows `<rows>`, `<min_ts>` .. `<max_ts>`, lag `<data_lag_days>d`.
Lineage: git `<sha>< dirty marker>`, gate `<gate_fingerprint>`, config `<config_ids_fingerprint>`, context `<context_fingerprint>`, `AI_MODE=<mode>`, `MIN_AI_QUALITY=<n>`, `DIRECTION_POLICY=<both|long_only|short_only|direction_aware>`.
Runtime comparison: `<comparable|different experiment|not checked>` — <one sentence>.
```

### 2. Outcome and tail risk

Always include `full`, `180d`, `90d`, `30d`, and `7d`, in that order. Keep a
row with zero approvals. In a comparison, put all gate rows for a window next
to each other before moving to the next window.

```md
### Outcome and tail risk

| Window | Gate |   N |  WR |  PF | PnL | PnL/trade | MaxDD | Loss streak | Losing months |
| ------ | ---- | --: | --: | --: | --: | --------: | ----: | ----------: | ------------- |
```

### 3. Cadence and fan-out

Use the same windows and gate-row order as the outcome table.

```md
### Cadence and fan-out

| Window | Gate | Trades/day | Events/day | Active days | Events | Trades/event | p95 batch | Max batch | Top event count | Top event PnL |
| ------ | ---- | ---------: | ---------: | ----------: | -----: | -----------: | --------: | --------: | --------------: | ------------: |
```

### 4. Risk-adjusted metrics

Use the same windows and gate-row order. Do not omit unavailable ratios.

```md
### Risk-adjusted metrics

| Window | Gate | Sharpe | Sortino | Calmar | DD/gross | DD/PnL | Profit/day | Profit/month | Trades/week |
| ------ | ---- | -----: | ------: | -----: | -------: | -----: | ---------: | -----------: | ----------: |
```

### 5. Quality and direction

Use rows `qN+ total`, `q(N+1)+`, `LONG qN+`, and `SHORT qN+`, in that order.
When `N=5`, keep `q(N+1)+` as `n/a`.

For `long_only` or `short_only`, retain the suppressed direction as an explicit
zero-approval row. The raw-core direction metrics belong beside the approved
table in release research; never omit the losing or blocked counterfactual.

```md
### Quality and direction

| Slice | Gate |   N | Events |  WR |  PF | PnL | MaxDD | Max batch |
| ----- | ---- | --: | -----: | --: | --: | --: | ----: | --------: |
```

### 6. Runtime execution bridge

Keep gate approvals, submitted orders, and filled trades distinct. When runtime
or exchange evidence is outside the task, keep one row of `n/a` values instead
of implying that every approval filled.

```md
### Runtime execution bridge

| Scope | Window | Approved | Attempts | Filled | Balance rejects | Other rejects | Requested notional | Max simultaneous stop-risk |
| ----- | ------ | -------: | -------: | -----: | --------------: | ------------: | -----------------: | -------------------------: |
```

### 7. Validation

Do not rename row-based candidate-selection output to an untouched test.

```md
### Validation

| Partition      | Rows | Events | Approved N |  WR |  PF | PnL | MaxDD | Max batch |
| -------------- | ---: | -----: | ---------: | --: | --: | --: | ----: | --------: |
| train          |      |        |            |     |     |     |       |           |
| tuning         |      |        |            |     |     |     |       |           |
| untouched test |      |        |            |     |     |     |       |           |
```

### 8. Acceptance checks

Use only `PASS`, `FAIL`, or `UNKNOWN`.

```md
### Acceptance checks

| Check                     | Status | Evidence |
| ------------------------- | ------ | -------- |
| Freshness                 |        |          |
| Runtime lineage parity    |        |          |
| Independent-event support |        |          |
| Event concentration       |        |          |
| Portfolio capacity        |        |          |
| Symbol concentration      |        |          |
| Temporal stability        |        |          |
| Untouched test            |        |          |
```

### 9. Reject reasons and conclusion

Show exactly the top five terminal-30d reject reasons when threshold or pocket
tuning is in scope. Use `n/a` rows when the artifact does not contain them.

```md
### Top reject reasons (30d)

| Rank | Reason |   N | Share |
| ---: | ------ | --: | ----: |

### Conclusion

- Why: <short evidence-based explanation>.
- Residual risk: <tail, support, capacity, env, or validation gap>.
- Next check: <specific export, replay, or live observation>.
```

Put optional strategy-specific findings only after this fixed block under
`### Strategy-specific findings`. Never reorder or rename the fixed sections.

## Metric definitions

- `Events`: unique decision timestamps by default. Use a broader market episode
  only when its deterministic grouping rule is documented.
- `Events/day`: events divided by the evaluated calendar span, using the same
  minimum-one-day convention as `aiTrainMetrics.ts`.
- `Active days`: percentage of evaluated calendar days with at least one
  approved event.
- `Trades/event`: approved trades divided by events.
- `p95 batch` / `Max batch`: p95 and maximum approved trades sharing one event.
- `Top event count`: largest event's percentage of approved trades.
- `Top event PnL`: largest event's percentage of approved PnL. If total PnL is
  zero, report `n/a`.
- `Approved`: signals that passed the effective qN+ gate.
- `Attempts`: order submissions, including rejected submissions.
- `Filled`: successfully opened positions; do not call rejected attempts
  cancelled or completed trades.
- `Balance rejects`: attempts rejected specifically for insufficient available
  balance.
- `Max simultaneous stop-risk`: sum of configured per-order loss budgets in the
  largest event, before fill/rejection effects.
- `DD/gross` and `DD/PnL`: max drawdown divided by gross profit and total profit.
- `PnL/trade`: total PnL divided by completed trades. The backtest CLI progress
  `avg` is PnL per completed test/symbol and must not be used for this field.
  Report `n/a` when `N=0`.
- `Losing months`: count; append month ids in parentheses when non-zero.
- `qN+`: all approvals with quality greater than or equal to `N`; never use
  plain `qN` for this cumulative stream.

## Formatting rules

- Counts: integer.
- WR, shares, active days, and drawdown percentages: one decimal plus `%`.
- PF, Sharpe, Sortino, Calmar, PnL, PnL/trade, MaxDD, and profit rates: two decimals.
- Trades/day, events/day, and trades/week: three decimals.
- Trades/event and batch percentiles: two decimals.
- Timestamps: ISO-8601 UTC.
- Unknown or unavailable: exactly `n/a`; never use an empty cell, `null`,
  `undefined`, `Infinity`, a dash, or a guessed zero.
- Use `n/a` only after checking the source artifact; derive a metric from raw
  evaluations when the data exists instead of treating a missing summary field
  as missing evidence.
- Zero approvals: `N=0`, `PnL=0.00`, cadence `0.000`; ratio metrics remain
  `n/a`.
- Use the artifact's PnL unit. Do not add `$` unless the artifact explicitly
  establishes USD.
- Keep the metric names, section order, window order, and rounding unchanged
  between runs.

## Notes contract

Write each study to a new
`notes/<Strategy>/YYYY-MM-DD-<short-kebab-slug>.md` file. Never append dated
entries to a rolling strategy log. The file must first follow
`../../strategy-backtest-research/references/research-notes.md`, including the
resolved config and complete machine-readable metrics snapshot. Put the full
chat report contract above under `## Reported metrics`, then append these
sections in order when gate tuning is in scope:

1. strategy intent and exact causal field paths
2. existing gate audit with `keep`, `round`, `replace`, `disable`, or
   `needs-more-data`
3. live-env parity and feature provenance, including `target`, `benchmark`, or
   `global` scope
4. walk-forward evidence, symbol/event concentration, ablation, and negative
   control
5. raw and rounded thresholds, sensitivity, and boundary tests
6. rollout, old-gate cleanup, and remaining production blockers

Use migrated `notes/<Strategy>/*.md` files only as historical content
references. The shared research-note contract and this reporting contract, not
their legacy body formatting, control new records.
