# GitHub configuration ownership

This guide records secret names and ownership only. Secret values must never be
copied into Git, logs, issues, or research artifacts.

The canonical cross-repository migration table lives in
`TradeJS-Project/docs/github-environment-ownership.md`. This engine repository
documents the subset relevant to package publication.

## Engine release model

`TradeJS` publishes the engine package family from one verified source commit.
The workflow derives beta and stable versions only inside its job workspace,
builds and tests that versioned workspace, publishes every package candidate,
tags the verified source commit, and promotes the complete candidate set with
npm dist-tags.

The source branch keeps development versions and receives no release-version
commit. Consequently:

- delete the legacy `RELEASE_DEPLOY_KEY` repository secret;
- do not grant a deploy key bypass in the stable-branch ruleset;
- keep the ruleset bypass limited to organization administrators;
- do not add cross-repository package-update credentials.

## npm publishing credential

`NPM_TOKEN` belongs only to repositories that publish npm packages. Prefer one
organization secret restricted to exactly:

- `TradeJS`;
- `TradeJS-Base`;
- `TradeJS-Strategy-Kit`;
- every publishable `TradeJS-Strategy-*` repository.

Do not expose it to `TradeJS-Project`, `TradeJS-Deploy`,
`TradeJS-Workflows`, the docs repository, or the site repository. npm trusted
publishing may replace the token later without changing repository ownership.

Create a protected `npm-production` environment in each npm-publishing
repository. Stable promotion uses that environment; beta publication does not.
The environment must permit the scheduled promotion to run unattended. Manual
emergency promotion remains guarded by an explicit confirmation input.

The engine workflow needs only its scoped, ephemeral `GITHUB_TOKEN` for tagging
the already verified source commit. Independently published Base, Kit, and
strategy repositories also use their own scoped `GITHUB_TOKEN` for their
release commit and annotated tag. Set Actions workflow permissions to
`Read and write` in those package repositories; pull-request approval is not
required.

## Project and deployment credentials

`TradeJS-Project` composes exact stable package versions and publishes the
immutable application image. It does not publish npm packages and therefore
must not have `NPM_TOKEN` or an `npm-production` environment.

Its only cross-repository credential is `DEPLOY_REPOSITORY_TOKEN`, stored in the
protected `production` environment and restricted to dispatching
`TradeJS-Deploy`.

All server and research-agent credentials belong to the protected `production`
environment in `TradeJS-Deploy`:

- `SSH_HOST`, `SSH_USER`, `SSH_KEY`;
- `GIT_SSH_PRIVATE_KEY`, `AGENT_GITHUB_TOKEN`;
- `NEXTAUTH_SECRET`, `PG_PASSWORD`, `REDISINSIGHT_HTPASSWD`;
- `COINALYZE_API_KEY`.

Built-in `GITHUB_TOKEN` values are ephemeral workflow credentials. Never create
or migrate a secret with that name.

## Runtime configuration ownership

Secret-free application defaults belong to
`TradeJS-Project/deploy/runtime.env`. Local research defaults belong to
`TradeJS-Project/.env`. Host addresses, ports, server paths, resource limits,
TLS configuration, volume locations, and all secret injection belong to
`TradeJS-Deploy`.

The server-side research agent uses organization-level repository routing:

```dotenv
AGENT_GITHUB_ORGANIZATION=TradeJS-Dev
AGENT_GITHUB_BASE_BRANCH=main
```

It resolves the strategy repository from the strategy package identity;
TrendLine and ReverseTrendLine intentionally share
`TradeJS-Strategy-TrendLine`.

## Future private packages and images

If a strategy becomes private, add a separate read-only `NPM_READ_TOKEN` to
`TradeJS-Project`; never reuse the publishing token. If the Project application
image remains private, add a packages-read-only `GHCR_PULL_TOKEN` to
`TradeJS-Deploy` and authenticate the production host before pulling it.
