# Production baseline

Use this rule for every strategy research, candidate report, comparison,
revalidation, and research chart.

## Resolve the baseline before research

1. Check the authenticated TradeJS runtime first: call `tradejs_info`, then
   `runtime_get_status`, `runtime_list_strategies`, and
   `runtime_get_verification` for the Git-owned `production` deployment. Bind
   the result to the exact user, deployment, account, package version,
   `strategyRevision`, `deploymentCompositionId`, full effective core config,
   deterministic gate/context, direction policy, interval, universe, and
   runtime risk value. Local Redis, a backtest config, the newest research
   artifact, or an installed stable package is not production truth.
2. If the strategy is declared in that production deployment, its exact
   deployed composition is the one and only research `BASELINE`. Operational
   pause state does not change the composition identity. A previously selected
   candidate, historical control, rebuilt gate, or old stable package remains
   `CANDIDATE`, `REFERENCE`, or `DIAGNOSTIC`; it must not replace production.
3. A deployment does not have a fixed research `N`. Re-evaluate the exact
   production composition on the frozen common research window, universe,
   costs, execution assumptions, and normalized risk before showing its trade
   count or economics. Never reuse `N` from an older control and label it as
   production.
4. If live verification is unavailable, use the newest checksum-verified
   immutable deployment manifest and label the baseline identity
   `production-unconfirmed`. Do not guess from current source or local config.
   If the strategy is absent from production, say so and freeze one explicit
   research control; label it `research baseline`, never `production`.

## Promote a deployed candidate to the next baseline

A selected candidate becomes the baseline for future research only after the
production handoff is complete and the deployed package/config manifest,
`strategyRevision`, `deploymentCompositionId`, account binding, enabled
declaration, and runtime ownership have been verified. Starting publication,
editing Project config, or creating a forward-ready handoff is not enough.

After successful verification, append an immutable production-baseline record
to the existing strategy release/candidate ledger. Link the selected candidate
and its evidence hashes to the verified deployment identity, record the
effective config/gate/context and risk provenance, mark it
`current-production-baseline`, and mark the previous production baseline as
superseded for subsequent research. Do not rewrite the original research
selection or its historical roles. If cutover or verification fails, the
candidate remains a candidate and the previous verified production composition
remains the baseline.

Every later study must resolve production again before trusting the ledger.
The ledger is the durable handoff and audit trail; the verified deployment is
the authority for what is current.
