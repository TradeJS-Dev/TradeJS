# create-tradejs

Create a local TradeJS project, start Redis and Timescale, and open the Web UI.
On the first launch, choose the local `root` password on the install page. The
app then opens the dashboard, where **Create backtest** starts the first
backtest flow.

```bash
npx create-tradejs
```

The default project directory is `tradejs-project`. Pass a name to choose a
different directory:

```bash
npx create-tradejs my-trading-project
```

Docker with the Compose plugin and Node.js 20.19 or newer are required.

## Codex TradeJS skills

Every generated project includes the complete checksum-managed TradeJS skill
set in `.codex/skills`. The supporting skills execute one bounded operation:

- `$strategy-backtest-research` — implement or execute one preregistered core
  backtest experiment;
- `$ai-train-local-research` — analyze a frozen core/export's deterministic
  gate;
- `$backtest-config-redis` and `$save-strategy-config-from-backtest` — read a
  research grid or explicitly promote it into the Git-owned Project;
- `$runtime-parity-mismatch-analysis` — diagnose an existing parity artifact.

The focused lifecycle skills own user-level decisions:

- `$strategy-candidate-report` — show the latest selected candidate;
- `$strategy-candidate-compare` — compare it with production;
- `$strategy-improvement-plan` — produce a causal improvement plan;
- `$strategy-improvement-research` — run a new bounded research lineage;
- `$strategy-period-revalidate` — recheck frozen candidates on new data;
- `$strategy-forward-start` — publish and start the latest eligible candidate
  at `MAX_LOSS_VALUE=1`, or an explicitly named reproducible historical
  candidate under a prospective-only operator authorization;
- `$strategy-forward-status` — inspect prospective live evidence;
- `$strategy-risk-scale` — change only `MAX_LOSS_VALUE` after an explicit
  scaling request.

`$strategy-release` remains only as a deprecated compatibility router to one
focused lifecycle skill. It is not another research/deployment workflow.

Invoke one skill with one strategy name, for example:

```text
$strategy-forward-start MarketFlushReversal
```

Forward start is an explicit live rollout request. It still requires an exact
deployment/account binding and a configured package publication and deployment
workflow; the scaffolder does not invent production credentials or hosting.
Operator-directed mode does not rewrite an old research verdict: it preserves
the original selection and contrary evidence and requires positive full-period
PnL, profit factor above 1, and checksum-verifiable configuration and charts.

The generated files include `.codex/tradejs-skill-bundle.json`, which binds the
installed skills to the canonical TradeJS bundle by SHA-256. To update only
that managed bundle in an existing project, use an explicitly selected
`create-tradejs` version:

```bash
npx create-tradejs@<approved-version> --update-skills .
```

The updater preserves unrelated custom skills and refuses to overwrite a
modified managed file. When a new release first brings an existing official
TradeJS skill under bundle management, the explicit update adopts that
same-named official snapshot from the canonical bundle.

## License

The `create-tradejs` scaffolder remains MIT-licensed. Generated projects
install TradeJS packages with mixed MIT and Business Source License 1.1 terms;
see the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

Keywords: ai, claude, codex.
