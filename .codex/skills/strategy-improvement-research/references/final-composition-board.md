# Final composition board

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
4. Freeze common calendar train, tuning, and test boundaries once in the parent
   lineage. Keep all rows sharing a timestamp in one partition. Candidate
   exports may have different row counts, but final comparison windows and test
   timestamps must not move to make one candidate look better. Discovery may
   inspect only train and tuning. Open all candidate test tails together after
   every gate spec is immutable.
   Use `ai-gate-ablation.mjs --tuningSince <UTC> --testSince <UTC>` with the
   same values for every candidate; ratio-only splits are not comparable when
   core event cadence differs.
5. Count every inspected core and gate behavior in the final trial ledger. The
   selected strategy is `core identity + candidate-specific gate identity +
context identity + direction policy + quality threshold`. Reusing economics
   from another core, using the production gate without replaying it on the new
   export, or comparing a gated candidate with raw baseline is invalid.

The five gate slots are a hard per-core maximum, not a target. Prefer a compact
causal board: current gate, explicit direction pass-through/block when the raw
side evidence warrants it, one causal pocket, one protected pocket, and one
direction-aware replacement. Do not fill slots with adjacent threshold nudges.

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
