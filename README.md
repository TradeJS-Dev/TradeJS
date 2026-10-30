# TradeJS

TradeJS is a TypeScript framework for building trading strategies, backtesting,
and running live signals with optional automated trading.

This repository contains the framework, CLI, and web application. Use this
README to set up a development checkout and contribute changes. To use the
published packages in your own project, follow the
[installation guide](https://docs.tradejs.dev/getting-started/installation).

## Set up your checkout

You need Node.js `24.19.0` (see [.nvmrc](.nvmrc)) and Yarn `4.13.0`
(the version pinned in [package.json](package.json)). Docker with the Compose
plugin is needed only for flows that use databases.

Fork the repository if you don't have write access, then clone your fork instead
of the URL below. Run the following commands from the repository root:

```bash
git clone https://github.com/tradejs-dev/tradejs.git
cd tradejs
nvm install
nvm use
corepack enable
yarn install --immutable
git switch -c fix/describe-your-change origin/stable
yarn build
```

The `nvm` commands require [nvm](https://github.com/nvm-sh/nvm). You can also
install the Node.js version from `.nvmrc` with your preferred version manager.

## Find the code

| Path                      | Responsibility                                         |
| ------------------------- | ------------------------------------------------------ |
| `apps/app`                | Web UI and API                                         |
| `packages/core`           | Browser-safe APIs, configuration, and shared helpers   |
| `packages/node`           | Node.js strategy runtime and backtest execution        |
| `packages/types`          | Shared TypeScript contracts                            |
| `packages/infra`          | Storage, networking, and other infrastructure adapters |
| `packages/indicators`     | Built-in indicators                                    |
| `packages/connectors`     | Exchange connectors and market data providers          |
| `packages/cli`            | CLI commands                                           |
| `packages/create-tradejs` | New-project scaffolding                                |
| `examples/sandbox`        | Integration example using published npm packages       |

Strategy implementations, strategy helpers, and the default preset live in
separate repositories. Public articles belong in TradeJS-Docs, and the website
belongs in TradeJS-Site. See [REPOSITORIES.md](REPOSITORIES.md) to choose the
repository for your change.

Keep browser-safe code in `core`, server runtime code in `node`, and storage
adapters in `infra`. Import across packages through public paths such as
`@tradejs/core/config`, `@tradejs/node/registry`, and `@tradejs/infra/redis`.
Shared types come from `@tradejs/types`. Avoid imports through another package's
`src` directory; `core`, `node`, and `infra` have no root exports.

## Run the app when needed

Start Docker, then create a local `.env` in the repository root with these
settings. Set `NEXTAUTH_SECRET` to a random local value before starting the app.
Keep `.env` out of Git.

```dotenv
APP_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-a-random-local-secret
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
PG_HOST=127.0.0.1
PG_PORT=5432
PG_USER=app
PG_PASSWORD=app
PG_DATABASE=app
```

Use host addresses for the databases because the development app runs outside
Docker. The Compose defaults match the database credentials above.

```bash
yarn infra-up
yarn doctor
yarn user-add -u root -p '<your-local-password>'
yarn dev
```

Open [localhost:3000](http://localhost:3000) and sign in at `/routes/signin` with
the local user you created. `yarn dev` builds workspace dependencies before
starting the app. To stop, press Ctrl+C and run `yarn infra-down`.

Use a separate TradeJS Project for personal backtests, research data, and live
operations. Its configuration, databases, and credentials belong to that
project. The commands above are for developing this repository's app.

## Verify your changes

Put tests in the package that owns the behavior. While working, run the relevant
test file with `yarn unit path/to/file.test.ts --runInBand`.

Before opening a pull request, run:

```bash
yarn checks
```

The command formats source files and runs architecture checks, builds, lint,
type checks, sandbox source type checks, and unit tests with coverage. Review
any formatting changes before committing. For a README-only change, use
`yarn prettier README.md --check` and check its links and command references.

For changes to the sandbox or published-package integration, also run:

```bash
yarn sandbox:install
yarn sandbox:infra-up
yarn sandbox:e2e
yarn sandbox:infra-down
```

The sandbox installs published packages from its own lockfile. It does not test
unpublished workspace changes.

## Open a pull request

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution terms and full
review process. Discuss substantial changes or new public APIs in
[GitHub Discussions](https://github.com/tradejs-dev/tradejs/discussions) before
implementation.

Keep each pull request focused and target `stable`. Describe the problem, your
change, and the checks you ran. Include screenshots for visible UI changes and
state any checks you could not run. Add an entry under `Unreleased` in
[CHANGELOG.md](CHANGELOG.md) for notable user-facing changes.

Report reproducible bugs in
[GitHub Issues](https://github.com/tradejs-dev/tradejs/issues). Follow
[SECURITY.md](SECURITY.md) to report vulnerabilities privately.

## License

TradeJS uses Business Source License 1.1 and MIT licenses for different parts
of the repository. See [LICENSING.md](LICENSING.md) for package scopes and terms.
