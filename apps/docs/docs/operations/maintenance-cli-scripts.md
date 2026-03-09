---
title: Maintenance and Debug CLI Scripts
---

This page covers operational scripts that are useful but easy to miss.

## Cleanups

Clean local files under `data/*`:

```bash
npx @tradejs/cli clean-dir --dir cache
npx @tradejs/cli clean-dir --dir ml/export
```

Clean Redis area/prefix:

```bash
npx @tradejs/cli clean-redis --area cache
npx @tradejs/cli clean-redis --area users:root:tests:
```

Clean test keys for all users or one user:

```bash
npx @tradejs/cli clean-tests
npx @tradejs/cli clean-tests --user root
npx @tradejs/cli clean-tests --user root --cache
```

## User Management

Create/update user in Redis:

```bash
npx @tradejs/cli user-add --user root --password 'secret'
```

Optional persistent token:

```bash
npx @tradejs/cli user-add --user root --password 'secret' --token '<token>'
```

## Legacy History Migration

Migrate JSON candle files (`data/history/*.json`) to Timescale:

```bash
npx @tradejs/cli migration
```

## Connector / Order Debug

Manual connector smoke script:

```bash
npx @tradejs/cli test-script
```

ML gRPC payload smoke script:

```bash
npx @tradejs/cli test-ml
```

## Environment Health

```bash
npx @tradejs/cli doctor
npx @tradejs/cli doctor --require-ml
npx @tradejs/cli doctor --skip-ml
```
