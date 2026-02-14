# ML Transform (RU)

Актуально для:
- `src/utils/testing.ts`
- `src/utils/indicators.ts`
- `src/utils/mlTrainingTransform.ts`
- `src/utils/mlDatasetFile.ts`

## 1. Новый поток ML-данных

1. Во время backtest сигнал сразу преобразуется в ML-строку.
2. Строка сразу дописывается в JSONL-файл чанка воркера:
   - `ml-dataset-[strategyName]-[chunkId].jsonl`
3. Redis `ml:*` для сигналов/результатов больше не используется.
4. `yarn ml-export` теперь объединяет chunk-файлы в единый dataset JSONL.
5. CSV больше не генерируется.

## 2. Окна

- Окно сбора индикаторов/свечей в сигнале: `50` (`ML_BASE_CANDLES_WINDOW`).
- В `mlTrainingTransform` ряды считаются по широкому окну `50`:
  - `INDICATOR_WINDOW = 50`
  - `ML_CANDLE_FEATURE_WINDOW = 50`
- Перед записью в файл строка обрезается до последних `5` значений:
  - `trimMlTrainingRowWindows(row, 5)`.

## 3. Базовые преобразования

- `toNumber`, `safeDiv`, `safeLog1p`, `clamp`, `squash`.
- Backward-returns:
  - `prefix_1` не создается,
  - `prefix_2..prefix_5` идут от старого к новому return.
- Лейбл:
  - `label=1` при `profit>0`,
  - `label=0` при `profit<=0`,
  - `label=null`, если `profit` отсутствует/невалиден.

## 4. Статистические дубли (Mean/Std/Skew/Kurt)

Добавлены моменты по окну 50 (`*_Mean50`, `*_Std50`, `*_Skew50`, `*_Kurt50`) для:
- `ATR_PCT`
- `Price24hPcnt`
- `Price1hPcnt`
- `MACD_Histogram`

Также свечные агрегаты считаются по окну 50:
- `AltRet_Mean50/Std50/Skew50/Kurt50`
- `BtcRet_Mean50/Std50/Skew50/Kurt50`
- `RelRet_Mean50/Std50/Skew50/Kurt50`

## 5. Важные переименования

- `Regime_RealizedVol_10` -> `Regime_RealizedVol_50`
- Использование диапазона 24h в контексте:
  - `TF15M_HighPrice24h_50`
  - `TF15M_LowPrice24h_50`

## 6. Что не пишется

- `currentPrice` (в output-строку не попадает)
- CSV-версии датасета
- Redis ключи `ml:*` для ML-export pipeline
