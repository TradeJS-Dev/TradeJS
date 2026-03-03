---
sidebar_position: 4
title: Cloud-использование
---

## Текущий cloud endpoint

Продакшен-стенд TradeJS:

- `https://aleksnick01inv.fvds.ru/`

## Базовый процесс выкладки

1. Подготовьте production `.env` с реальными секретами.
2. Соберите и поднимите контейнеры (`docker compose up -d --build`).
3. Проверьте, что живы `app`, `timescale`, `redis`, `ml-infer`.
4. Прогоните `yarn doctor` в рабочем окружении.

## Минимальный чек-лист безопасности

- Установите надежный `NEXTAUTH_SECRET`.
- Закройте прямой доступ к портам БД и Redis извне.
- Храните ключи в secret manager, а не в репозитории.
- Используйте HTTPS (в текущем стеке это `nginx + certbot`).

## Обновления без боли

- Обновите код и пересоберите образы.
- Перед включением live-ордеров проверьте health checks.
- Держите rollback-теги для `app` и `ml-infer`.
