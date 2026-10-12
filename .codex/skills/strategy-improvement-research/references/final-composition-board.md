# Final composition board

## Explicit actual-execution branch

The opt-in `executionBasis: closed-loop-execution` branch is distinct from the
legacy posthoc conditional subset. Its `metricBasis` must be `completed-trade`.
Legacy inputs without the new discriminator keep their existing JSON bytes,
fingerprints and chart layout. Never mix raw, posthoc and actual curves.

Use `executed-composition-report.mjs --projectRoot <Project> --authority
<Project-relative authority.json> --outputPrefix <new Project-relative prefix>`
to produce exclusive `.report.json` and `.receipt.json` outputs. The authority
schema is `tradejs-executed-composition-authority/v1`; it binds the frozen
composition, calendar, gate boundary, selection rule, config, universe/cohorts,
native manifest and all completed checkpoints through the public run-binding
validator. It also binds compiled-source/runtime checkpoints, source-build and
operational Node receipts, actual fee-notional authority, closed native streams
and separate hook streams. Actual manifest flags are checksum-bound in full,
including optional flags; required fields prove cache-only, AI export, research
trace and the frozen one-bar entry delay. Actual costs are checked per native
test, not invented as a manifest top-level field. The separately frozen context
contract is linked to the actual operational receipt. Unavailable flags must
not be invented from a filename.

The parallel proposed `tradejs-entry-execution-observation/v1` stream contains
`gate-invocation-link`, `before-place-order-attempt` and
`after-place-order-executed`. An invocation link checksum-binds the unchanged
legacy gate record. Increasing observation sequences and checksum-bound,
secret-free `tradejs-research-worker-process-receipt/v1` records linked from
unchanged-schema `tradejs-research-worker-observation/v1` bind later stages.
Opt-in worker receipts cannot contain argv or environment values. Legacy gate
and inventory direction is joined from the exact captured decision, never
added to their original bytes. Native trace entry/exit timestamps reconcile
actual fills; their funnel membership uses the original decision timestamp.
False own-gate calls retain their exact link, but cannot have any later entry
stage. Prior-manifest veto without an own call is counted separately and has
no fabricated gate hash or own-call coverage. Mixed hook streams require a
checksum-bound stage selector. No legacy gate record is
extended or rewritten. Real use requires a separately accepted opt-in bridge
and legacy/storage parity receipt. Missing acceptance remains `UNKNOWN` and
retains diagnostics; synthetic fixtures do not establish real authority.

Runtime/compiled-source checks run read-only while the exact candidate overlay
is still installed, after owned worker groups are gone and native manifests
are complete, **before overlay restoration**. A runtime mismatch fails closed;
the report never installs, rebuilds or repairs packages. Source-build Node and
operational Node are different receipt roles and may legitimately differ.
Later builder/chart operations consume checksum-bound frozen reports and
receipts, not a freshly restored baseline runtime checkpoint.

Each report contains 99 observed and 99 same-identity 20-bps stress cells:
eight exit windows (full covered 1461 days, then terminal 1460/1095/365/180/90/30/7)
plus DEV, TEST and independent NEW_TAIL decision views, each crossed with
ALL/LONG/SHORT and all576/120/456 symbol metadata groups. Requested coverage is
1825 days; covered coverage is 1461, never labelled five complete years.
NEW_TAIL can overlap DEV or TEST; intersections and decision funnels are
diagnostics, not additive support. Unknown gate cutoff remains null and cannot
fall back to the raw-core development boundary. DEV labels crossing the gate
cutoff are excluded from fitting. TEST outcomes may mature until frozen END
exclusively. Exact-END terminal closures reconcile natively but never enter
half-open economic tables.

Only TEST/all-universe/ALL cells apply the frozen criteria: finite PF >=1.10,
positive PnL, >=50 independent decision events, cadence >=0.075/day,
MaxDD <=100 and loss streak <=4. Same-fill extra20-bps stress requires PnL

> =-100, finite PF >=0.8 and MaxDD <=150. Terminal/full/side/cohort diagnostics
> cannot select a winner. Selection authority is frozen before execution and
> contains no future selected ID or outcomes. `authority-blocked` and
> `no-eligible-composition` both have `selectedId: null`; no failing candidate is
> renamed the winner. Zero samples have null PF/WR/payoff/quantiles and truthful
> zero PnL/DD, not a finite PF or a percentage advantage over zero baseline.

The builder consumes `executedCompositionAuthority`,
`executedCompositionReport` and `executedCompositionReceipt` descriptors for
each candidate, plus a common `selectionAuthority`. No fake core export is
required for verified zero completions. Verified empty equity is exactly
`{status: verified-empty, stream: null, rows: 0}`; the dashed zero guide is an
annotation outside the observed-data layer. An unavailable stream is UNKNOWN,
not a zero guide. The LiquidityZones baseline is installed stable core plus
exact current AI-gate under frozen research risk/costs, not active production.

Compact disk indexes and bounded external merge sorting never retain whole
payload/trade/equity arrays. Equity reduction retains actual endpoints and
bucket extrema without smoothing. Logical memory, fan-in, input row/byte and
disk limits are explicit; sampled/disk-accounted limits are not filesystem
quotas. Reports include field availability distinctions (missing, explicit
null, invalid, unsupported), unchanged-input proofs and resource receipts.
Charts write a new exclusive directory and checksum their frozen sources;
raw diagnostic artifacts must remain in a separate output directory.

Use this contract after raw-core discovery is complete. Its purpose is to make
the research unit an executable strategy composition, not an intermediate core
or a gate tuned on another core's signal population.

## Gate isolation

1. Freeze the raw-core board first. It contains the authoritative baseline and
   every complete, reconciled, behavior-changing core candidate. Core family
   continuation and rescue choices use only raw-core evidence; a gate result
   cannot reopen or rewrite that board.
2. Produce one acceptance-grade raw AI export for every board member, including
   the baseline. Bind its core research ID, resolved-config SHA-256, source diff
   or commit, export SHA-256, window, universe, execution assumptions, and
   context lineage.
3. Run `$ai-train-local-research` independently for every export. Each core gets
   its own current-gate control, pocket discovery, five-variant maximum ablation,
   selected gate expression or implementation, full structured report, and
   fingerprint. On the production core export, preserve two distinct final
   compositions: the exact current AI-gate replay, checksum-bound to its
   gate-authority report, and the independently rebuilt gate. The current gate
   is the baseline; the rebuilt gate is a research candidate. A no-op,
   zero-approval, or rejected gate still receives a checksum-bound report and
   explicit disposition; it is not silently omitted.
4. Freeze common calendar development/test boundaries once in the parent
   lineage: outer 60/40, preserving whole timestamp groups. Search the whole
   development partition and diagnose three consecutive blocks inside it.
   These blocks overlap development, not independent validation. Candidate
   exports may have different cadence, but the outer boundary must not move.
   Freeze every gate spec before opening all outer test tails together.
   Use `ai-gate-ablation.mjs --testSince <UTC>` with the same boundary for every
   candidate; ratio-only splits are not comparable across different cadence.
5. Count every inspected core and gate behavior in the final trial ledger. The
   selected strategy is `core identity + candidate-specific gate identity +
context identity + direction policy + quality threshold`. Reusing economics
   from another core, using the production gate without replaying it on the new
   export, or comparing a gated candidate with raw baseline is invalid.

The five gate slots are a hard per-core maximum, not a target. Prefer a compact
causal board: current gate, explicit direction pass-through/block when the raw
side evidence warrants it, one causal pocket, one protected pocket, and one
direction-aware replacement. Do not fill slots with adjacent threshold nudges.

For a candidate measured by an actual compiled adapter rather than an ablation
expression, declare `gateSource: variant` and `compiledGateAuthority: <native
ai-train report path>` instead of `variantName` in the selection. Its own
ablation report's measured `baseline` supplies metrics and equity. The builder
checksum-binds the native authority to the same core export and direction
policy. Never relabel an expression variant as a compiled adapter or use the
compiled candidate as the current-gate baseline.
The generated composition stores the candidate's authority as
`compiledGateAuthority`; the renderer verifies that checksum and includes it
in the composition fingerprint. `gateAuthority` remains reserved for the
current-gate baseline.

Declare `metricBasis: completed-trade` in the selection to consume each gate
report's explicit `realized.periods` and `realized.equity`, ordered and sliced
by `tradeResult.exitTimestamp`. Missing realized evidence fails the builder;
it never silently substitutes decision-time drawdown. The legacy default is
`decision-time` and must be labelled as such in comparison limitations.

Freeze independently discovered causal pockets into an auditable candidate
spec before opening comparison evidence:

```bash
node .codex/skills/strategy-improvement-research/scripts/freeze-gate-variants.mjs \
  --pocket data/ai/output/<candidate>-pocket.json \
  --candidateId <candidate> --output data/ai/output/<candidate>-gate-spec.json
```

## Final comparison

Build two separate tables:

- **Raw-core diagnostics**: baseline and every raw core with the fixed
  ALL/LONG/SHORT contract. These metrics explain the mechanism but never enter
  the final strategy leaderboard as if they were deployable compositions.
- **Final compositions**: the exact production core + current AI-gate baseline,
  the production core + rebuilt gate candidate, and exactly one frozen own-gate
  result for every other raw-core candidate. Apply economic validity, support,
  drawdown, cadence, concentration, stability, cost, and holdout rules here.

Normalize PnL and drawdown to one recorded `MAX_LOSS_VALUE` risk unit before
ranking or charting. Use the same half-open comparison window and terminal
`365d`, `180d`, `90d`, `30d`, and `7d` slices for every composition, including
zero-trade windows. A gate without sufficient untouched support remains visible
as `research-only` or `blocked`; the chart is not evidence of readiness.

## Mandatory visual artifacts

Create the board from authoritative structured reports with:

```bash
node .codex/skills/strategy-improvement-research/scripts/build-final-composition-spec.mjs \
  --selection data/strategy-release/<lineage>/final-composition-selection.json \
  --output data/strategy-release/<lineage>/final-composition-board.json \
  --terminalComparisonIds <selected-id>,<additional-candidate-id>
node .codex/skills/strategy-improvement-research/scripts/final-composition-board.mjs \
  --spec data/strategy-release/<lineage>/final-composition-board.json \
  --outDir data/strategy-release/<lineage>/final-composition-charts
```

The input uses schema `tradejs-final-composition-board/v1`. Every composition
must declare `composition.kind = core+deterministic-gate` and `gateSource` as
`current` or `variant`, the same normalized risk unit, complete full/terminal
metrics, cumulative equity points, and three checksum-verified inputs: core
result, core export, and gate report. The baseline additionally requires the
checksum-verified current `gateAuthority`. The script recomputes those hashes,
requires `baselineId` to identify the current-gate composition, and derives the
composition fingerprint; do not paste an unverified fingerprint into the spec.
`--terminalComparisonIds` is an optional presentation override for a derived
board: it leaves `selectedId` unchanged and allows a versioned comparison chart
without rewriting the frozen selection artifact.

The legacy/posthoc board also accepts explicit `selectedId: null` when no
composition qualifies. Both charts say `No eligible composition`; KPI cards
show only the exact current-gate baseline, labelled `Baseline diagnostics`.
No candidate or baseline receives a winner highlight or becomes selected in
the summary. All equity curves and scatter points remain visible. Terminal
comparisons remain diagnostic and retain the existing one-to-three candidate
limit; use separate presentation versions to show a larger board. Missing
`selectedId` remains invalid. Existing non-null selections render unchanged.
The compact legacy summary is not a full metric appendix: checksum-bound native
ablation JSON reports remain authoritative for complete realized, directional,
partition, stability and round-trip cost-stress metrics. This does not claim
closed-loop execution or its 99-cell matrix.

Required outputs:

- `final-composition-dashboard.svg` and `.png`: selected composition KPI cards
  versus the production core + current AI-gate baseline, grouped terminal PnL bars with trade counts for
  the baseline plus `terminalComparisonIds`, a PnL-versus-realized-MaxDD plot
  of every final composition, and limitations. `terminalComparisonIds`
  defaults to `[selectedId]`; it may include up to three candidate IDs, must
  include `selectedId`, and does not change the research selection;
- `final-composition-equity.svg` and `.png`: cumulative PnL curves for the
  current production composition and every research composition on the common
  time axis;
- `final-composition-summary.json`: derived composition fingerprints, source
  hashes, normalized metrics, and hashes of all four rendered files.

SVG is the canonical deterministic rendering. PNG is the chat-ready rendering
of the same SVG. Link or display both charts in the final answer and immutable
research note. Store the complete board spec and summary in Project-owned
evidence; paths alone do not replace the note's machine-readable metrics.

For these research comparison charts, use continuous straight segments between
the recorded equity samples by default, not staircase corners. This matches the
preferred presentation without averaging returns or rounding away drawdowns.
Keep the observed endpoints and extrema; do not use moving averages or splines
that invent peaks or troughs. The connecting line is a visual interpolation,
not a claim about account value between events or an intratrade mark-to-market
path. Record `rendering.equityInterpolation = linear` in the chart summary.
For presentation-only updates, render to a new output directory and retain the
frozen reports, equity arrays, metrics, selections, and original chart files.

## Spec shape

```json
{
  "schema": "tradejs-final-composition-board/v1",
  "strategy": "ExampleStrategy",
  "researchId": "example-improvement-20260825-v1",
  "title": "ExampleStrategy final compositions",
  "subtitle": "Common cache-only window; sealed test opened once",
  "baselineId": "production-current-gate",
  "selectedId": "candidate-a-own-gate",
  "terminalComparisonIds": ["candidate-a-own-gate", "candidate-b-own-gate"],
  "comparisonWindow": { "start": 1690848000000, "end": 1787616000000 },
  "normalization": { "pnlUnit": "research PnL", "maxLossValue": 10 },
  "limitations": ["Point-in-time universe is incomplete"],
  "candidates": [
    {
      "id": "production-current-gate",
      "label": "production core + current AI-gate",
      "role": "baseline",
      "status": "eligible",
      "color": "#315f7d",
      "riskUnit": 10,
      "composition": {
        "kind": "core+deterministic-gate",
        "gateSource": "current",
        "coreResearchId": "example-control",
        "coreConfigSha256": "<sha256>",
        "coreResult": {
          "path": "data/research/core/example-control/result.json",
          "sha256": "<sha256>"
        },
        "coreExport": {
          "path": "data/ai/export/example.jsonl",
          "sha256": "<sha256>"
        },
        "gateReport": {
          "path": "data/ai/output/example-gate.json",
          "sha256": "<sha256>"
        },
        "gateAuthority": {
          "path": "data/ai/output/example-current-gate-authority.json",
          "sha256": "<sha256>"
        },
        "gateFingerprint": "<sha256>",
        "configFingerprint": "<sha256>",
        "contextFingerprint": "<sha256>",
        "directionPolicy": "both",
        "minQuality": 4
      },
      "metrics": {
        "trades": 100,
        "pnl": 250,
        "profitFactor": 1.5,
        "maxDrawdown": 70
      },
      "terminal": [
        { "days": 365, "trades": 40, "pnl": 120 },
        { "days": 180, "trades": 20, "pnl": 60 },
        { "days": 90, "trades": 10, "pnl": 30 },
        { "days": 30, "trades": 3, "pnl": 8 },
        { "days": 7, "trades": 1, "pnl": 2 }
      ],
      "equity": [
        [1690848000000, 0],
        [1787615999999, 250]
      ]
    }
  ]
}
```

# Closed-loop pagination and complete metric appendix

The closed-loop rendering branch produces one compact dashboard and one equity
chart, plus `final-composition-matrix-NNN-<candidate-id>.svg` and `.png` for each
candidate. Each page retains exactly 99 observed and 99 same-fill 20-bps stress
cells. Cell identity includes candidate, basis, axis, window/partition, symbol
group and direction. Only `OUTER_TEST_FROZEN/ALL_UNIVERSE/ALL` is marked as the
frozen selection cell. All other cells and full-period/terminal/scatter views are
diagnostic. No candidate is omitted, including blocked or verified-empty ones.

`final-composition-metrics.json` copies every original cell field, including
availability and denominator status. `final-composition-metrics.md` provides the
same complete fields as readable per-cell tables. The compact dashboard keeps
every candidate's KPI row, five terminal windows, scatter label and full observed
and stress rule states. Short keys map to complete names and exact rule values.
Its nonvisual `data-cell` metadata indexes the separate matrix pages; it is not a
monolithic matrix image.

`summary.rendering.pagination` is `per-candidate-matrix/v1`. Its `matrixPages`
maps every candidate to ordinal, dimensions, exact cell identities, counts and
SVG/PNG checksums. All charts and both appendices also appear in
`summary.artifacts`. Output directories and files are exclusive. Every layout
and per-page pixel budget (200,000,000 pixels maximum) is checked before writes
and rasterization. A large page fails closed; the renderer never clips, truncates
or silently drops its fields.

Numeric PnL and MaxDD axes include zero. Equity has numeric Y ticks, a distinct
zero guide and exact start/end plus bounded interior UTC calendar ticks. Empty
zero guides are explicitly annotations, not observed equity. Unavailable curves
never become zero observations. Scatter points retain their real positions;
labels use deterministic side lanes and leader lines. Exposed label boxes allow
tests to check boundaries and lane overlap, including long names/coincident points.

This change only projects verified fields. Selection, metrics, candidate order,
fingerprints, authority inputs, linear equity interpolation and retained extrema
are unchanged. The legacy raw/posthoc branch and its SVG golden bytes are unchanged.
