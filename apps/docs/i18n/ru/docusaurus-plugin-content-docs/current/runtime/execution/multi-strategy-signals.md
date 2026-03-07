---
title: Мульти-стратегии в runtime
---

`yarn signals` умеет запускать несколько стратегий за один проход.

Источник:

- `packages/cli/src/scripts/signals.ts`

## Как подгружаются стратегии

Для выбранного пользователя runtime сканирует ключи:

- `users:<user>:strategies:*:config`

Для каждого ключа:

- извлекает имя стратегии из ключа Redis
- берет creator через `getStrategyCreator(strategyName)`
- читает config payload из Redis

Неизвестные стратегии пропускаются с warning.

## Порядок выполнения по символу

1. Загружает свечи символа и BTC-контекст.
2. Итерирует стратегии в отсортированном порядке config-key.
3. Выполняет каждую стратегию.
4. На первом непустом сигнале:

- сохраняет сигнал в Redis
- прекращает проверку остальных стратегий для этого символа

Текущее поведение: **первый сигнал выигрывает для символа** в рамках одного запуска.

## Контекст данных

Каждой стратегии передается:

- свечи символа (`data`)
- свечи BTC (`btcData`)
- свечи BTC Binance/Coinbase (для spread/correlation)

Runtime принудительно прокидывает:

- `ENV: 'CRON'`
- выбранный `INTERVAL`
- `MAKE_ORDERS` из CLI-флага

## Практический сценарий

1. Положите несколько конфигов в `users:<user>:strategies:<Strategy>:config`.
2. Запустите:

```bash
yarn signals --user root --timeframe 15
```

3. Опционально нотификации/ордера:

```bash
yarn signals --user root --timeframe 15 --notify --makeOrders
```

## Связанные статьи

- `runtime/execution/signals`
- `runtime/backtesting/results-runtime-config`
