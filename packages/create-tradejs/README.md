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

## License

The `create-tradejs` scaffolder remains MIT-licensed. Generated projects
install TradeJS packages with mixed MIT and Business Source License 1.1 terms;
see the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).
