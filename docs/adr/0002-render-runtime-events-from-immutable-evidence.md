# Render runtime events from immutable evidence

Runtime strategy charts will render composition, gate, `MAX_LOSS_VALUE`, deployment, parity, and recommendation events from checksum-verified immutable evidence rather than reconstructing them from expiring Redis lineage scopes or current config. Missing evidence is shown explicitly instead of using a mutable fallback; the normalized marker ledger remains durable when verbose payloads expire.

To keep strategy cards compact, the chart shows labeled vertical markers while their legend, filters, and provenance live in an `Evidence` popover. Composition, loss-value, deployment, and evidence-boundary events are always available; parity and advisory recommendation markers can be hidden by the user.

The dashboard binds a ledger only by the frozen composition id or a complete
runtime identity containing clean git SHA, core-config fingerprint, deterministic
gate fingerprint, context fingerprint, and `MAX_LOSS_VALUE`. Strategy name or
config alone is insufficient; config-only cards display missing evidence.
