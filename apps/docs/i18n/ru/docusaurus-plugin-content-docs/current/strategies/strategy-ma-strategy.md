---
title: 'Стратегия: MaStrategy (референс)'
---

`MaStrategy` — TypeScript-стратегия (`packages/core/src/strategy/MaStrategy`) на пересечении fast/slow скользящих.

## Логика входа

1. Берет history snapshot индикаторов (`maFast[]`, `maSlow[]`).
2. Определяет crossover по двум последним точкам:

- bullish: fast пересек slow снизу вверх
- bearish: fast пересек slow сверху вниз

3. Если включен соответствующий side-конфиг (`LONG` или `SHORT`), считает TP/SL/qty.
4. Проверяет `minRiskRatio`, cooldown (`TRADE_COOLDOWN_MS`) и (вне бэктеста) `MAX_CORRELATION`.
5. Возвращает `entry` с MA-линиями и точкой пересечения в figures.

## Выходы

Если позиция открыта, противоположный MA-cross закрывает ее с кодом `CLOSE_BY_OPPOSITE_MA_CROSS`.
Иначе стратегия возвращает `POSITION_HELD`.

## Параметры конфига

Side-конфиги:

- `LONG.enable`, `LONG.direction`, `LONG.TP`, `LONG.SL`, `LONG.minRiskRatio`
- `SHORT.enable`, `SHORT.direction`, `SHORT.TP`, `SHORT.SL`, `SHORT.minRiskRatio`

Риск/runtime:

- `FEE_PERCENT`, `MAX_LOSS_VALUE`, `MAX_CORRELATION`
- `TRADE_COOLDOWN_MS`

Общие runtime-поля:

- `ENV`, `INTERVAL`, `MAKE_ORDERS`, `BACKTEST_PRICE_MODE`
- `AI_ENABLED`, `MIN_AI_QUALITY`
- `ML_ENABLED`, `ML_THRESHOLD`

Периоды индикаторов, используемые напрямую:

- `MA_FAST`, `MA_SLOW`

## Payload сигнала

`figures`:

- линия `ma-fast`
- линия `ma-slow`
- точка `ma-cross`

`additionalIndicators`:

- `crossKind`
- `maFastPrev`, `maFastCurrent`, `maSlowPrev`, `maSlowCurrent`
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
