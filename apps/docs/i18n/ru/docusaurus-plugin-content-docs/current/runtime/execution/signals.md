---
sidebar_position: 9
title: Как работают сигналы
---

## Точка входа

```bash
npx @tradejs/cli signals
```

Основной скрипт:

- `@tradejs/cli`

## Откуда берутся конфиги стратегий

Сигналы читают конфиги из Redis по ключам вида:

- `users:<user>:strategies:TrendLine:config`

И динамически поднимают creator:

```ts
const strategyCreator = await getStrategyCreator(strategyName);
const strategy = await strategyCreator({
  userName: flags.user,
  connector,
  symbol,
  data: [...cachedData],
  btcData: [...btcCachedData],
  btcBinanceData: [...btcBinanceData],
  btcCoinbaseData: [...btcCoinbaseData],
  config: {
    ...strategyConfig,
    ENV: 'CRON',
    INTERVAL: interval,
    MAKE_ORDERS: flags.makeOrders,
  },
});
```

## Пайплайн

1. Загружаются активные strategy config.
2. Загружаются рыночные данные по символам и BTC.
3. Для каждого символа выполняется runtime стратегии.
4. Сигналы сохраняются в Redis.
5. При необходимости отправляются скриншоты и Telegram-уведомления.

## Исполнение ордеров

- Включается флагом `--makeOrders`.
- Runtime может заблокировать исполнение по AI/ML policy.
- Сигнал может быть сохранен как `skipped`, даже если ордер не отправлен.

## Telegram-уведомления

```bash
npx @tradejs/cli signals --notify
```

Если есть AI-анализ, он уходит отдельным сообщением.

Подробная инструкция:

- [Telegram Notifications](./telegram-notifications)
