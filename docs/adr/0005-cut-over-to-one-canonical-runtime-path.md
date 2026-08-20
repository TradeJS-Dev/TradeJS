# Cut over to one canonical runtime path

Status: superseded by ADR 0006 and ADR 0007.

This ADR recorded the removal of mutable Redis strategy configuration and all
alternate production runtime paths. That boundary remains: Project Git owns
the complete desired declaration, while Redis owns only runtime evidence and
an optional manual pause override.

ADR 0006 replaced release records with complete declarations in
`TradeJS-Project/tradejs.config.ts`. ADR 0007 then replaced manual numeric
versions with computed `strategyRevision` and `deploymentCompositionId` values.
Those ADRs are the current contract; the obsolete record shape and rollout
commands from the original decision are intentionally not retained here as an
operational fallback.

The no-fallback rule is unchanged: old Redis records, mutable result overlays,
drafts, embedded deployment strategy config, and alternate persistence layouts
are invalid rather than migration inputs.
