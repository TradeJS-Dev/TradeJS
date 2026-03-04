---
title: 'Стратегия: Breakout (референс)'
---

`Breakout` — TypeScript-стратегия (`packages/core/src/strategy/Breakout`) с весовой моделью сигналов для long/short breakout-сценариев.

## Логика входа

На каждой свече стратегия считает набор булевых сигналов и входит, если пройден score и required-условия.

Long-сигналы:

- `VOLATILE`
- `SMA_UPTREND`
- `OBV_ABOVE_SMA`
- `PREV_HIGH_BREAKOUT`
- `CLOSE_ABOVE_UPPER_BB`
- `CLOSE_ABOVE_HIGH_LEVEL`
- `CLOSE_ABOVE_PREV_CLOSE`

Short-сигналы:

- `VOLATILE`
- `SMA_DOWNTREND`
- `OBV_BELOW_SMA`
- `PREV_LOW_BREAKDOWN`
- `CLOSE_BELOW_LOWER_BB`
- `CLOSE_BELOW_LOW_LEVEL`
- `CLOSE_BELOW_PREV_CLOSE`

Алгоритм:

1. Получает snapshot индикаторов (`nextIndicators`).
2. Считает сигналы.
3. Применяет веса/required из `SIGNALS_LONG` / `SIGNALS_SHORT`.
4. Сравнивает суммарный балл с `REQUIRED_SCORE_LONG` / `REQUIRED_SCORE_SHORT`.
5. Открывает позицию с TP-лестницей и SL.

## Выходы

При открытой позиции стратегия закрывает ее если:

- появился противоположный open-сигнал (`CLOSE_POSITION_BY_OPEN_SIGNAL`)
- MA-тренд развернулся против позиции (`CLOSE_POSITION_BY_SMA`)

Иначе возвращает `POSITION_HELD`.

## Параметры конфига

Модель скоринга:

- `SIGNALS_LONG`, `SIGNALS_SHORT`
- `REQUIRED_SCORE_LONG`, `REQUIRED_SCORE_SHORT`

Риск/ордера:

- `LIMIT` (размер позиции в quote-валюте)
- `TP_LONG[]`, `TP_SHORT[]` (`profit`, `rate`)
- `SL_LONG`, `SL_SHORT`

Чувствительность сигнала:

- `ATR_OPEN` (коэффициент порога волатильности)

Периоды общих индикаторов:

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW`
- `OBV_SMA`, `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG`
- `BB`, `BB_STD`, `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL`
- `LEVEL_LOOKBACK`, `LEVEL_DELAY`

Поля, которые есть в конфиге, но не используются текущим `core.ts`:

- `ATR_PERIOD`, `BB_PERIOD`, `BB_STDDEV`, `ATR_CLOSE`, `OBV_SMA_PERIOD`, `BREAKOUT_LOOKBACK_DELAY`, `BREAKOUT_LOOKBACK`

## Payload сигнала

`additionalIndicators`:

- `highLevel`, `lowLevel`
- `signals` (карта булевых проверок)

`figures` сейчас пустой (`buildBreakoutFigures()` возвращает `{}`).

## Пример runtime-конфига

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "LIMIT": 100,
  "ATR_OPEN": 0.5,
  "REQUIRED_SCORE_LONG": 7,
  "REQUIRED_SCORE_SHORT": 7,
  "TP_LONG": [
    { "profit": 0.1, "rate": 0.25 },
    { "profit": 0.15, "rate": 0.5 }
  ],
  "TP_SHORT": [
    { "profit": 0.05, "rate": 0.25 },
    { "profit": 0.1, "rate": 0.5 }
  ],
  "SL_LONG": 0.06,
  "SL_SHORT": 0.03
}
```

## Запуск

```bash
yarn backtest --user root --config Breakout:base --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
