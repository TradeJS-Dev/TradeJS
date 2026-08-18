# GitHub Configuration Migration

This guide contains names and ownership only. It never contains secret values.
GitHub does not expose existing secret values, so a move means creating the
target secret from the original credential source, verifying the target, and
only then deleting or restricting the old copy.

## Verified current state

The repository API currently exposes these repository secrets:

- `TradeJS`: `RELEASE_DEPLOY_KEY`
- `TradeJS-Deploy`: `AGENT_GITHUB_TOKEN`, `GIT_SSH_PRIVATE_KEY`,
  `NEXTAUTH_SECRET`, `REDISINSIGHT_HTPASSWD`

`NPM_TOKEN` is used successfully by reusable publication workflows but is not
listed as a repository secret with the current API token. Treat it as an
organization-level selected-repository secret and confirm its policy as an
organization administrator.

`TradeJS-Deploy` references `SSH_HOST`, `SSH_USER`, and `SSH_KEY`, but they are
not currently exposed as repository or environment secrets. Create them in
`TradeJS-Deploy` before the first new production rollout instead of assuming
they already exist.

## Secret routing

| Current source                                         | Name                              | Target                                                                                                                           | Action                                                                                                                                                                                             |
| ------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TradeJS organization/repository publication credential | `NPM_TOKEN`                       | Organization secret visible only to `TradeJS`, `TradeJS-Strategy-Kit`, `TradeJS-Base`, and every `TradeJS-Strategy-*` repository | Keep one publishing credential or replace it with npm trusted publishing. Do not copy it to `TradeJS-Project` or `TradeJS-Deploy`.                                                                 |
| `TradeJS`                                              | `RELEASE_DEPLOY_KEY`              | `TradeJS`                                                                                                                        | Keep while the synchronized release workflow pushes version commits and tags over SSH. Rotate independently; do not move to Project or strategy repos.                                             |
| `TradeJS-Deploy`                                       | `NEXTAUTH_SECRET`                 | `TradeJS-Deploy`                                                                                                                 | Keep. Deploy injects it into the Project app container at rollout time.                                                                                                                            |
| `TradeJS-Deploy`                                       | `REDISINSIGHT_HTPASSWD`           | `TradeJS-Deploy`                                                                                                                 | Keep. It belongs to the production reverse proxy.                                                                                                                                                  |
| `TradeJS-Deploy`                                       | `GIT_SSH_PRIVATE_KEY`             | `TradeJS-Deploy` under the same name                                                                                             | Replace with a machine-user SSH key that has read access to `TradeJS` and write access to every strategy repository the research agent may change. A single-repository deploy key is insufficient. |
| `TradeJS-Deploy`                                       | `AGENT_GITHUB_TOKEN`              | `TradeJS-Deploy` under the same name                                                                                             | Replace with a least-privilege GitHub App token or fine-grained PAT covering all strategy repositories, with contents and pull-request read/write access.                                          |
| Credential source used for the production host         | `SSH_HOST`, `SSH_USER`, `SSH_KEY` | Create in `TradeJS-Deploy`                                                                                                       | New required repository secrets for server deployment; they are referenced by the workflow but currently absent from the visible configuration.                                                    |
| New credential, not copied from npm publishing         | `DEPLOY_REPOSITORY_TOKEN`         | Create in `TradeJS-Project`                                                                                                      | Fine-grained token or GitHub App credential limited to dispatching `TradeJS-Deploy`.                                                                                                               |
| New rotated database credential                        | `PG_PASSWORD`                     | Create in `TradeJS-Deploy`                                                                                                       | Remove the checked-in `app` value, rotate the Timescale role, and inject the new secret during deploy.                                                                                             |

Built-in `GITHUB_TOKEN` values are per-workflow ephemeral credentials. Do not
copy or migrate them.

Create the protected `npm-production` environment in `TradeJS`,
`TradeJS-Project`, `TradeJS-Base`, `TradeJS-Strategy-Kit`, and each publishable
`TradeJS-Strategy-*` repository. Beta publication does not use this environment;
weekly stable promotion and the single weekly Project composition sync do. The
environment must allow the scheduled job to run unattended; manual emergency
promotion is separately guarded by an explicit confirmation input. The design
does not require a long-lived cross-repository package-update token.

Set Workflow permissions to `Read and write` in every independently published
base/kit/strategy repository so the reusable weekly job can commit the stable
package version and annotated tag with its scoped `GITHUB_TOKEN`. Keep “Allow
GitHub Actions to create and approve pull requests” disabled; this release train
does not need it.

## Future private packages and images

| When                                  | Name              | Repository        | Required scope                                                                              |
| ------------------------------------- | ----------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| A strategy package becomes private    | `NPM_READ_TOKEN`  | `TradeJS-Project` | Read-only access to the required private npm packages; never reuse `NPM_TOKEN`.             |
| The Project app image remains private | `GHCR_PULL_TOKEN` | `TradeJS-Deploy`  | Packages read-only; add an explicit GHCR login step on the server before enabling dispatch. |

The first `TradeJS-Project` workflow has published
`ghcr.io/tradejs-dev/tradejs-project-app`, but an anonymous pull is currently
denied. Before enabling production dispatch, choose one path:

1. In the GitHub package settings, make `tradejs-project-app` public so the
   current anonymous Compose pull works.
2. Keep the image private, create a read-only `GHCR_PULL_TOKEN` in
   `TradeJS-Deploy`, and add authenticated `docker login ghcr.io` handling.

Changing a package to public is an external visibility decision; do not perform
it as an automatic bootstrap side effect.

## Environment-variable ownership

Move these secret-free application defaults from inline Deploy workflow text
to `TradeJS-Project/deploy/runtime.env`:

- `RUNTIME_SIGNAL_RETENTION_DAYS`
- `BACKTEST_MAX_PARALLEL`
- `KLINE_CONCURRENCY_LIMIT`
- `SIGNALS_PARALLEL`
- `SIGNALS_KLINE_WS_ENABLED`
- `SIGNALS_KLINE_WS_WAIT_MS`
- `DERIVATIVES_CONTEXT_ENABLED`
- `DERIVATIVES_CONTEXT_INTERVALS`
- `DERIVATIVES_CONTEXT_LOOKBACK_HOURS`
- `DERIVATIVES_CONTEXT_TARGET_ENABLED`
- `DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS`
- `DERIVATIVES_CONTEXT_BACKFILL_BATCH_DAYS`
- `DERIVATIVES_CONTEXT_BACKFILL_REQUEST_DELAY_MS`
- `DERIVATIVES_CONTEXT_BACKFILL_SYMBOL_BATCH_SIZE`
- `PUPPETEER_SKIP_DOWNLOAD`
- `PUPPETEER_EXECUTABLE_PATH`

Replace the old research-agent pair in `TradeJS-Deploy`:

| Remove                                        | Add                                     |
| --------------------------------------------- | --------------------------------------- |
| `AGENT_GITHUB_REPOSITORY=TradeJS-Dev/TradeJS` | `AGENT_GITHUB_ORGANIZATION=TradeJS-Dev` |
| `AGENT_GITHUB_BASE_BRANCH=stable`             | `AGENT_GITHUB_BASE_BRANCH=main`         |

The agent resolves the exact strategy repository from the strategy name;
TrendLine and ReverseTrendLine both resolve to `TradeJS-Strategy-TrendLine`.

Keep deployment-specific values in `TradeJS-Deploy`: production URLs, service
addresses and ports, container memory limits, server paths, volume locations,
TLS configuration, and secret injection. Project defaults may be overridden by
Deploy only when the override is environment-specific and documented.
