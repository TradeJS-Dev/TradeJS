---
title: 'Стратегия: MaStrategy'
---

`MaStrategy` — TypeScript-стратегия (`packages/core/src/strategy/MaStrategy`) на пересечении fast/slow скользящих средних.

## Логика входа

1. Берет snapshot индикаторов (`maFast[]`, `maSlow[]`).
2. На двух последних точках проверяет crossover:

- bullish: fast пересекает slow снизу вверх
- bearish: fast пересекает slow сверху вниз

3. Выбирает side-конфиг (`LONG` или `SHORT`).
4. Считает TP/SL/qty.
5. Проверяет `minRiskRatio`, cooldown и `MAX_CORRELATION`.
6. Возвращает `entry`.

## Выходы

Если позиция открыта, противоположный MA-cross закрывает ее с кодом `CLOSE_BY_OPPOSITE_MA_CROSS`.
Иначе стратегия возвращает `POSITION_HELD`.

## Параметры конфига (что означает каждый)

### Общие runtime-параметры

- `ENV` — режим запуска.
- `INTERVAL` — таймфрейм.
- `MAKE_ORDERS` — выполнять ордера или только считать сигналы.
- `BACKTEST_PRICE_MODE` — режим цены исполнения в бэктесте.

### AI/ML-параметры

- `AI_ENABLED` — включает AI enrichment/gating.
- `MIN_AI_QUALITY` — минимальное качество AI для исполнения.
- `ML_ENABLED` — включает ML enrichment.
- `ML_THRESHOLD` — порог ML-оценки.

### Параметры торговли и риска

- `CLOSE_OPPOSITE_POSITIONS` — закрывать противоположные позиции перед новым входом (через hook).
- `FEE_PERCENT` — комиссия в расчетах риск/прибыль.
- `MAX_LOSS_VALUE` — максимальный риск для вычисления `qty`.
- `MAX_CORRELATION` — ограничение по корреляции с BTC.
- `TRADE_COOLDOWN_MS` — пауза между сделками в миллисекундах.

### Параметры индикаторов

- `MA_FAST` — период быстрой скользящей средней.
- `MA_SLOW` — период медленной скользящей средней.

### Параметры сценария `LONG`

- `LONG.enable` — включить/выключить long-сценарий.
- `LONG.direction` — направление ордера (`LONG`).
- `LONG.TP` — take-profit в процентах.
- `LONG.SL` — stop-loss в процентах.
- `LONG.minRiskRatio` — минимально допустимое риск/прибыль.

### Параметры сценария `SHORT`

- `SHORT.enable` — включить/выключить short-сценарий.
- `SHORT.direction` — направление ордера (`SHORT`).
- `SHORT.TP` — take-profit в процентах.
- `SHORT.SL` — stop-loss в процентах.
- `SHORT.minRiskRatio` — минимально допустимое риск/прибыль.

## Используемые индикаторы (что означает каждый)

- `maFast` — быстрая MA, используется для детекции пересечения.
- `maSlow` — медленная MA, используется для детекции пересечения.
- `correlation` — корреляция с BTC, используется как риск-guard.

## Payload сигнала

`figures`:

- линия `ma-fast`
- линия `ma-slow`
- точка `ma-cross`

`additionalIndicators`:

- `crossKind`
- `maFastPrev`, `maFastCurrent`
- `maSlowPrev`, `maSlowCurrent`
- `maGap`
- `correlation`

## Пример runtime-конфига

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MA_FAST": 21,
  "MA_SLOW": 55,
  "TRADE_COOLDOWN_MS": 0,
  "LONG": {
    "enable": true,
    "direction": "LONG",
    "TP": 2,
    "SL": 1,
    "minRiskRatio": 1.5
  },
  "SHORT": {
    "enable": true,
    "direction": "SHORT",
    "TP": 2,
    "SL": 1,
    "minRiskRatio": 1.5
  }
}
```

## Запуск

```bash
yarn backtest --user root --config MaStrategy:base --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
