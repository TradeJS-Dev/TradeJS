---
title: Maintenance and Debug CLI Scripts
---

This page covers operational scripts that are useful but easy to miss.

## Cleanups

Clean local files under `data/*`:

```bash
yarn clean-dir --dir cache
yarn clean-dir --dir ml/export
```

Clean Redis area/prefix:

```bash
yarn clean-redis --area cache
yarn clean-redis --area users:root:tests:
```

Clean test keys for all users or one user:

```bash
yarn clean-tests
yarn clean-tests --user root
yarn clean-tests --user root --cache
```

## User Management

Create/update user in Redis:

```bash
yarn user-add --user root --password 'secret'
```

Optional persistent token:

```bash
yarn user-add --user root --password 'secret' --token '<token>'
```

## Legacy History Migration

Migrate JSON candle files (`data/history/*.json`) to Timescale:

```bash
yarn migration
```

## Connector / Order Debug

Manual connector smoke script:

```bash
yarn test
```

ML gRPC payload smoke script:

```bash
yarn test-ml
```

## Redis Search Helper (ML)

Find ML signal keys by `context.testSuiteId`:

```bash
yarn ts-node ./packages/cli/src/scripts/findMlSignalsByTestSuite.ts --testSuiteId 861d9d --pattern 'ml:signals:*'
```

## Environment Health

```bash
yarn doctor
yarn doctor --require-ml
yarn doctor --skip-ml
```
