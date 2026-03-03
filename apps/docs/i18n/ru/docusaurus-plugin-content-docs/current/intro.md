---
sidebar_position: 1
title: Документация TradeJS
slug: /
---

Это официальный справочник по TradeJS.

Если коротко, TradeJS помогает:

- запускать торговые стратегии в live-режиме,
- искать и отправлять сигналы,
- тестировать идеи на истории (бэктесты),
- обучать и подключать ML-модели,
- добавлять AI-проверку сигналов перед исполнением ордера.

Документация устроена вокруг текущего monorepo:

- `apps/app` — веб-интерфейс и API на Next.js,
- `packages/core` — сердце системы: runtime стратегий, типы и утилиты,
- `packages/connectors` — интеграции с биржами и провайдерами данных,
- `packages/cli` — команды для ежедневной работы,
- `packages/framework` — публичный API для пользовательских плагинов,
- `packages/ml` — Python-часть для обучения и инференса.

## С чего начать

- [Локальный запуск](./getting-started/local)
- [Self-hosted развертывание](./getting-started/self-hosted)
- [Cloud-использование](./getting-started/cloud)
- [Framework API](./framework/api)
- [CLI API](./cli/api)
