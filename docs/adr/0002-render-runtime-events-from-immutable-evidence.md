# Render runtime events from immutable evidence

Status: superseded for production UI by ADR 0006. The marker format remains a
local/CI research artifact.

Runtime strategy charts will render composition, gate, `MAX_LOSS_VALUE`, deployment, parity, and recommendation events from checksum-verified immutable evidence rather than reconstructing them from expiring Redis lineage scopes or current config. Missing evidence is shown explicitly instead of using a mutable fallback; the normalized marker ledger remains durable when verbose payloads expire.

To keep strategy cards compact, the chart shows labeled vertical markers while their legend, filters, and provenance live in an `Evidence` popover. Composition, loss-value, deployment, and evidence-boundary events are always available; parity and advisory recommendation markers can be hidden by the user.

For production runtime cards, ADR 0005 replaces composition/fingerprint
selection with the explicit per-strategy `releaseVersion`. A verified artifact
must name that version; otherwise the UI reports `not_attached`. Research
artifacts retain their internal hashes for verification, but they are not
runtime selectors.
