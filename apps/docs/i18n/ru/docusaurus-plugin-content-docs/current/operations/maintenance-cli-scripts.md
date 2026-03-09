---
title: Maintenance и debug CLI-скрипты
---

Здесь собраны сервисные скрипты, которые полезны в эксплуатации и отладке.

## Очистка

Очистка локальных файлов в `data/*`:

```bash
npx @tradejs/cli clean-dir --dir cache
npx @tradejs/cli clean-dir --dir ml/export
```

Очистка Redis area/prefix:

```bash
npx @tradejs/cli clean-redis --area cache
npx @tradejs/cli clean-redis --area users:root:tests:
```

Очистка test-ключей для всех пользователей или одного:

```bash
npx @tradejs/cli clean-tests
npx @tradejs/cli clean-tests --user root
npx @tradejs/cli clean-tests --user root --cache
```

## Управление пользователями

Создать/обновить пользователя в Redis:

```bash
npx @tradejs/cli user-add --user root --password 'secret'
```

Опциональный persistent token:

```bash
npx @tradejs/cli user-add --user root --password 'secret' --token '<token>'
```

## Миграция legacy-истории

Перенос JSON свечей (`data/history/*.json`) в Timescale:

```bash
npx @tradejs/cli migration
```

## Отладка коннектора / ордеров

Ручной smoke-скрипт коннектора:

```bash
npx @tradejs/cli test-script
```

Smoke-скрипт ML gRPC payload:

```bash
npx @tradejs/cli test-ml
```

## Проверка состояния окружения

```bash
npx @tradejs/cli doctor
npx @tradejs/cli doctor --require-ml
npx @tradejs/cli doctor --skip-ml
```
