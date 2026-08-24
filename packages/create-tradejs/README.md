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

## Codex strategy skills

Every generated project includes focused workflow skills in `.codex/skills`:

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

## License

The `create-tradejs` scaffolder remains MIT-licensed. Generated projects
install TradeJS packages with mixed MIT and Business Source License 1.1 terms;
see the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

Keywords: ai, claude, codex.
