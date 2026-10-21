# Completed research storage

Read this when finishing a research lineage or cleaning an older completed
study. The Project owner keeps compact results and frozen candidates permanently.
Trade rows, AI feature exports, trace streams, intermediate datasets and
run-specific caches are temporary. Remove them after the entire study finishes,
including gate evaluation, comparisons and final charts. A completed backtest
inside an active study is not permission to remove its inputs.

## Permanent records

Use the existing note, candidate manifest and trial ledger. Do not create a
second best-candidate pointer. Before cleanup, preserve:

- Every hypothesis and candidate, including rejected and failed attempts, its
  causal claim, exact resolved config, source commit and any uncommitted patch,
  deterministic gate code/config, context settings, parent IDs and verdict.
  A hash or a deleted worktree path does not preserve candidate source.
- The common comparison scope: timestamps, ordered symbols, interval, fees,
  slippage, execution assumptions, risk unit, code/tool versions, train/test
  boundaries, exposure history and reconciliation/completion results.
- Structured metrics for every reported candidate, period and ALL/LONG/SHORT
  cohort, including zero-trade cohorts, statistical checks, limitations and
  candidate-minus-control deltas. Preserve selected and rejected reasons and
  the full trial denominator. Keep compact month/fold/regime summaries and
  cost tests needed to explain the decision.
- Final reports and charts, the ledger/index and artifact hashes. Freeze any
  chart points needed to render the final chart before removing trade rows.
  Store aggregate metrics in JSON; do not embed trades or matched-pair objects
  in the permanent note merely to retain a large export under another name.

Follow [research-notes.md](research-notes.md), and run `yarn notes:check`.
Review the actual configs, source and metrics, not just the frontmatter label.
The record must explain which old behavior was tried and why the next study
should reuse or reject it. Future research reads these records before choosing
new hypotheses. Compare saved results directly only on matching scopes and
risk units. Changed periods or assumptions require a new frozen evaluation.

## Cleanup

The research owner performs cleanup as the final step of the study, without a
new approval request. The owner's storage policy authorizes removal of temporary
research files after their permanent records have been verified. Keep files
needed by another unfinished study. Never clear a whole shared cache, Redis,
market history, runtime evidence or unrelated research directory.

Create a retention inventory under the study directory. Use the installed
`yarn strategy-release retention` command with these fields:

```json
{
  "now": 1792108800000,
  "research": {
    "researchId": "example-study",
    "status": "completed",
    "completedAt": 1792108800000,
    "permanentArtifacts": [
      {"role": "note", "path": "notes/MyStrategy/2026-10-16-example.md", "sha256": "<actual SHA-256>"},
      {"role": "candidates", "path": "data/strategy-release/example/candidates.json", "sha256": "<actual SHA-256>"},
      {"role": "metrics", "path": "data/strategy-release/example/metrics.json", "sha256": "<actual SHA-256>"}
    ]
  },
  "entries": [
    {
      "path": "data/ai/export/example.jsonl",
      "kind": "research_payload",
      "researchId": "example-study",
      "sha256": "<actual SHA-256>",
      "createdAt": 1792022400000,
      "bytes": 1234,
      "verified": true,
      "aggregated": true
    }
  ]
}
```

Use actual timestamps, sizes and hashes. `research_cache` identifies disposable
run-specific cache files. The same note may serve several permanent roles when
it embeds the complete candidate and metric records; list its exact checksum
for each role. Add source patches, gate files, manifests, ledgers, indexes and
charts to `permanentArtifacts` too. Only explicit files inside Project `data/`
are eligible. Files open in another process, symlinks, notes and patches are
protected. The command checks all permanent and disposable hashes before
removing any file, and writes an incremental cleanup receipt.
On macOS, cached virtual-machine file handles require an additional read-only
check of the actual processes inside every local Docker container that mounts
those files. Unreadable or unresolved consumers keep the files protected.

```bash
yarn strategy-release retention --input <inventory.json>
yarn strategy-release retention --input <inventory.json> --apply
```

Check that the plan's `deleteCount` matches the intended inventory before
applying, then check the completed receipt. An older installed CLI may not
support research entries and may return zero deletions. In the canonical
workspace, use the explicitly built framework CLI from the Project directory
when that happens, and record its source SHA/dirty diff:

```bash
PROJECT_CWD="$PWD" node "$TRADEJS_FRAMEWORK_REPOSITORY_ROOT/packages/cli/dist/cli.js" \
  strategy-release retention --input <inventory.json> [--apply]
```

Do not change installed package versions or publish a release just to clean
research files. If the built source CLI is unavailable, keep the inventory and
report cleanup as pending rather than claiming the files were removed.

Research payloads have no age delay once the study is complete and aggregated.
The separate runtime retention policy remains unchanged. Keep the inventory and
receipt and its deletion journal with the permanent records. A future comparison can use the saved
numbers and reproduce the candidate by rerunning its frozen code/config. New
trade-level questions and new historical windows require a rerun. Do not claim
the removed files remain available for checksum verification.

## Older studies

Recover available compact results and candidate definitions from existing
notes, configs, manifests and reports without starting another backtest. If
the missing evidence cannot be recovered without a rerun, retire the old study
and delete its temporary payloads. The owner explicitly authorized that policy.
Keep its original partial/blocked status and record the gaps. Never fabricate
historical configs, metrics or successful completion.

Use `research.status: retired` and set `completedAt` to the retirement decision
time. Add `retirement: {policy: "discard-unrecoverable-without-rerun", reason:
"<specific reason>", missingEvidence: ["<recorded gaps>"]}`. Preserve all
available notes, candidate/source/config files and compact metrics. The tool
permits partial or blocked notes in this mode and records the retirement in
the cleanup receipt. `aggregated: false` records genuinely missing aggregates;
file checksum verification remains mandatory. Active studies are never retired
merely to reclaim disk space.

## Worktree removal

Remove the study's dedicated worktree after freezing permanent candidate and
result records, including when a selected candidate exists. Retain its
commit/branch and exact source. For old idle research worktrees, preserve dirty
and untracked source before removal. Do not delete branches, canonical checkouts,
locked or managed checkouts belonging to active chats, or ongoing studies.

Inspect the owning repository's `git worktree list` and checkout status.
The helper preserves a Git history bundle, source snapshot and staged/unstaged
patches, verifies their contents, and refuses worktrees with open files:

```bash
python3 .codex/skills/strategy-backtest-research/scripts/retire-worktree.py \
  --repository <canonical-repository> --worktree <exact-worktree> \
  --out data/worktree-cleanup/<id>
```

Review its plan, then repeat with `--apply`. Keep the source archive and
receipt permanently. Prune stale registrations only after checking that their
directories are actually absent, and preserve their branch/commit identities
in the cleanup inventory. For Codex-managed worktrees attached to this chat,
prefer the app's archive tool, which preserves recoverable state.
