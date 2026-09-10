# Excluding features before pocket search

`ai-pocket-search --excludeFeaturePattern <regex>` (short form `-x`) applies an
optional JavaScript regular expression to dot-separated feature paths before
feature buckets and atomic predicates are ranked. The expression is case
sensitive, without slash delimiters or flags. An invalid expression fails during
option normalization, before loading a dataset or strategy. Omission or an empty
string preserves the existing search behavior.

Use this option when the research protocol excludes a provenance family that the
general `causal-stationary` classification permits. For example:

```bash
yarn ai-pocket-search --strategy AdaptiveMomentumRibbon --file <exact-export.jsonl> \
  -n 0 --featurePolicy causal-stationary --featureProfile all \
  --excludeFeaturePattern 'marketBreadths|(^|\.)cmc|referenceContexts\.(?!BTCUSDT(\.|$))'
```

Freeze the actual expression with the experiment before inspecting pocket
outcomes. This example is only a provenance filter; it is not a complete feature
policy or evidence of profitability. Audit the remaining feature paths against
the protocol, including source metadata and clock fields. A symbol-specific
exception requires a fixed benchmark established in the protocol.

Matching a source branch skips its descendants. Filtering takes place before
derived features are calculated, so an excluded source value cannot populate a
derived alias. Generated feature paths are also filtered before search. Existing
outcome, coverage, and stationarity exclusions remain in force; this option can
only remove features. Removing a source field can also remove a derived feature
that depended on it.

The JSON run metadata records `excludeFeaturePattern`. JSON
`featurePolicyAudit["operator-excluded"]` reports the number of distinct excluded
paths and up to five sample paths. These are research policy exclusions, not
missing-data or data-quality failures. A matched branch counts once, rather than
counting its unvisited descendant leaves. Text and Markdown reports also record
the expression. Preserve the expression, report, source revision, exact dataset,
and checksums together.

A post-search filter does not provide the same contract: prohibited predicates
may have already consumed the atomic ranking budget and displaced allowed ones.
This option does not change trade labels, PnL, gate decisions, or execution, and
does not automatically impose the same expression on a separate gate replay.
