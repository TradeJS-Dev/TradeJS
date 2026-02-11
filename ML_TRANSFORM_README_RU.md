# ML Transform: описание полей

Актуально для `src/utils/mlTrainingTransform.ts`.

## 1. Вход/выход

Вход:
- `signalRecord.signal`
- `signalRecord.context`
- `resultRecord`

Выход:
- плоская строка фич `Record<string, number | string | null>`.

## 2. Базовые принципы

- Нормализация числа: `toNumber(...)`
- Безопасное деление: `safeDiv(a, b)` (если `b=0` -> `0`)
- Лог-преобразование: `safeLog1p(x) = sign(x) * log1p(|x|)`
- Свечи сортируются по времени `old -> new`.
- Окна:
  - `INDICATOR_WINDOW = 10`
  - `CANDLE_WINDOW = ML_CANDLE_FEATURE_WINDOW`

## 3. Индексация backward-returns

Для ряда длины `N` считаются `N-1` returns по соседним элементам, начиная с конца:
- `r_last = xN/xN-1 - 1`, `r_prev = xN-1/xN-2 - 1`, ...

В поля записывается хронологически:
- `prefix_1` **не создаётся**
- `prefix_2` = самый старый return
- ...
- `prefix_N` = самый новый return

Итого: при backward-returns отсутствует **первый индекс**, не последний.

## 4. Базовые поля строки

- `symbol`: `signal.symbol || context.symbol || result.symbol` -> upper-case
- `direction`: `LONG -> 1`, иначе `0`
- `entryTimestamp`: timestamp последней base-свечи
- `takeProfitPrice = currentPrice / takeProfitPrice`
- `stopLossPrice = currentPrice / stopLossPrice`
- `riskRatio`, `Correlation`, `Touches`, `Distance`

Не пишутся в output:
- `currentPrice`
- `TrendLine_Value_AtEntry`

## 5. Индикаторные серии

### 5.1 Raw (`addSeriesRaw`)
- `ATR_PCT_*`
- `Price24hPcnt_*`
- `Price1hPcnt_*`

### 5.2 Std (`addSeriesStd`)
- сейчас для этих полей не используется.

### 5.3 Backward-returns (без деления на `maMedium`)
- `ATR_*`
- `MA_Fast_*`
- `MA_Medium_*`
- `MA_Slow_*`
- `BB_Upper_*`, `BB_Middle_*`, `BB_Lower_*`
- `HighPrice1h_*`, `LowPrice1h_*`
- `HighPrice24h_*`, `LowPrice24h_*`
- `MACD_*`, `MACD_Signal_*`, `MACD_Histogram_*`

### 5.4 OBV/SMA_OBV
- `OBV_LogRet_*`: сначала `safeLog1p(obv)`, потом backward-returns
- `SMA_OBV_LogRet_*`: сначала `safeLog1p(smaObv)`, потом backward-returns

### 5.5 Volume-модули
- `Volume1h_*`, `Volume24h_*` = `safeLog1p(volume)`
- `Volume1h_*_MedianNorm`, `Volume24h_*_MedianNorm`:
  - `value_i / median(window up to i)`
  - индекс `1` не создаётся (только `2..10`)

## 6. Candle-фичи (base + TF1H/TF4H/TF1D)

Одинаковая логика для base и для `TF1H_`, `TF4H_`, `TF1D_`.

### 6.1 Внутрисвечные returns
- `AltRet_i = altClose_i / altOpen_i`
- `BtcRet_i = btcClose_i / btcOpen_i`
- `RelRet_i = AltRet_i - BtcRet_i`

### 6.2 `AltToBtc_*` (backward-returns)
Сначала raw-ratio:
- `altOpen/btcOpen`, `altClose/btcClose`, `altHigh/btcHigh`, `altLow/btcLow`

Потом backward-returns с индексированием из раздела 3:
- `AltToBtc_Open_*`
- `AltToBtc_Close_*`
- `AltToBtc_High_*`
- `AltToBtc_Low_*`

### 6.3 `Candle_Body_*`
- сырой ряд: `(close - open) / priceScale`
- затем z-score по окну (`standardizeSeries`)

### 6.4 Остальные свечные (формулы)
- `Candle_Range_i = (high - low) / priceScale`
- `Candle_UpperWick_i = (high - max(open, close)) / priceScale`
- `Candle_LowerWick_i = (min(open, close) - low) / priceScale`
- `Candle_Direction_i = close >= open ? 1 : 0`
- `BTC_Candle_Body_i = (btcClose - btcOpen) / lastBtcClose`
- `BTC_Candle_Range_i = (btcHigh - btcLow) / lastBtcClose`
- `BTC_Candle_UpperWick_i = (btcHigh - max(btcOpen, btcClose)) / lastBtcClose`
- `BTC_Candle_LowerWick_i = (min(btcOpen, btcClose) - btcLow) / lastBtcClose`
- `BTC_Candle_Direction_i = btcClose >= btcOpen ? 1 : 0`

### 6.5 Свечные объёмы
- `Candle_Volume_i = safeLog1p(volume_i)`
- `BTC_Candle_Volume_i = safeLog1p(btcVolume_i)`
- `Candle_Volume_i_MedianNorm`, `BTC_Candle_Volume_i_MedianNorm` только для `i > 1`

### 6.6 Агрегаты по окну
- `AltRet_Mean10`, `AltRet_Std10`, `AltRet_Skew10`, `AltRet_Kurt10`
- `BtcRet_Mean10`, `BtcRet_Std10`, `BtcRet_Skew10`, `BtcRet_Kurt10`
- `RelRet_Mean10`, `RelRet_Std10`, `RelRet_Skew10`, `RelRet_Kurt10`

## 7. TrendLine

- `TrendLine_Mode`
- `TrendLine_Distance`
- `TrendLine_Alpha_1..10`

### 7.1 Points
- `POINTS_VALUE_1..2 = point.value / currentPrice`
- `POINTS_TS_1 = delta_minutes(lastTs - pointTs) / intervalMinutes`
- `POINTS_TS_2` не создаётся

### 7.2 Touches
- берутся последние 3 touches по времени
- `TOUCHES_VALUE_1..3 = touch.value / currentPrice`
- `TOUCHES_TS_1..3 = delta_minutes(lastTs - touchTs) / intervalMinutes`
- если touch меньше 3 — недостающие заполняются `0`

### 7.3 Производные
- `TrendLine_Delta_To_Price = (currentPrice - tlAtEntry) / currentPrice`
- `TrendLine_Slope = log1p(abs(slopePerBar))`

## 8. Label/profit

- `label = 1`, если `profit > 0`
- `label = 0`, если `profit <= 0`
- `label = null`, если `profit` невалидный
- `profit`: число или `null`

## 9. Не генерируются

- `interval`
- `currentPrice`
- `TrendLine_Value_AtEntry`
- `TRENDLINE_minTouches`, `TRENDLINE_offset`, `TRENDLINE_epsilon`, `TRENDLINE_epsilonOffset`
- `POINTS_TS_2`
