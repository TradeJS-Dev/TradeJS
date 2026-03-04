---
title: Maintenance и debug CLI-скрипты
---

Здесь собраны сервисные скрипты, которые полезны в эксплуатации и отладке.

## Очистка

Очистка локальных файлов в `data/*`:

```bash
yarn clean-dir --dir cache
yarn clean-dir --dir ml/export
```

Очистка Redis area/prefix:

```bash
yarn clean-redis --area cache
yarn clean-redis --area users:root:tests:
```

Очистка test-ключей для всех пользователей или одного:

```bash
yarn clean-tests
yarn clean-tests --user root
yarn clean-tests --user root --cache
```

## Управление пользователями

Создать/обновить пользователя в Redis:

```bash
yarn user-add --user root --password 'secret'
```

Опциональный persistent token:

```bash
yarn user-add --user root --password 'secret' --token '<token>'
```

## Миграция legacy-истории

Перенос JSON свечей (`data/history/*.json`) в Timescale:

```bash
yarn migration
```

## Отладка коннектора / ордеров

Ручной smoke-скрипт коннектора:

```bash
yarn test
```

Smoke-скрипт ML gRPC payload:

```bash
yarn test-ml
```

## Поиск ключей в Redis (ML)

Поиск ML signal keys по `context.testSuiteId`:

```bash
yarn ts-node ./packages/cli/src/scripts/findMlSignalsByTestSuite.ts --testSuiteId 861d9d --pattern 'ml:signals:*'
```

## Проверка состояния окружения

```bash
yarn doctor
yarn doctor --require-ml
yarn doctor --skip-ml
```
