---
sidebar_position: 1
title: Overview
slug: /
---

Это официальный справочник по TradeJS.

Если коротко, TradeJS помогает:

- запускать торговые стратегии в live-режиме,
- искать и отправлять сигналы,
- тестировать идеи на истории (бэктесты),
- обучать и подключать ML-модели,
- добавлять AI-проверку сигналов перед исполнением ордера.

Для внешнего использования важны два пакета:

- `@tradejs/core` — browser-safe API для авторинга, config-helper’ы и общие indicator/math/time helper’ы
- `@tradejs/node` — Node runtime для исполнения стратегий, бэктестов, Pine loader и plugin/connector registry
- `@tradejs/cli` — рабочие команды для бэктестов, сигналов, ботов, проверок и ML-процесса

## С чего начать

- [Quickstart](./getting-started/quickstart)
- [Настройка root пользователя](./getting-started/root-user)
- [Core API](./api/framework)
- [CLI API](./api/cli)
- [Как создавать стратегии](./strategies/authoring/write-strategies)
- [Как писать индикаторы](./indicators/authoring)
