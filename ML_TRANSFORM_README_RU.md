# ML Transform (RU)

Актуально на 2026-02-18.

Применимо к:
- `src/utils/testing.ts`
- `src/utils/mlTrainingTransform.ts`
- `src/utils/mlGrpc.ts`
- `src/utils/mlDatasetFile.ts`

## 1. Поток данных

1. `yarn backtest` формирует ML payload по сигналам и пишет строки в chunk JSONL.
2. `yarn ml-export` только объединяет chunk-файлы в merged JSONL.
3. Train режет merged JSONL на `holdout`, `prod` и `walk-forward` окна.
4. Обучение использует только `*.train.*`, тестирование только `*.test.*`.

## 2. Окна и causality

- Перед построением фич из `signal.indicators` удаляется последний элемент у всех массивов.
- Базовое окно после этого:
  - `indicatorWindow = max(1, ML_BASE_CANDLES_WINDOW - 1)`
  - `candleWindow = max(1, ML_CANDLE_FEATURE_WINDOW - 1)`
- Финальный шаг: `trimMlTrainingRowWindows(row, 5)`.
- В итоге в dataset/infer уходят только хвосты `_1.._5` (без `_49/_50`).

## 3. Нейминг фич

- Для всех TF используется единый порядок:
  - `TF*_ALT_*` — признаки текущей монеты,
  - `TF*_BTC_*` — признаки BTC.
- Для mixed-признаков без отдельного asset-prefix (например, `RelRet`, `AltToBtc`) сохраняются отдельные имена.

## 4. Что важно для parity train/prod

- В backtest: `buildMlTrainingRow` -> `trimMlTrainingRowWindows(..., 5)` -> запись в JSONL.
- В inference (`mlGrpc`): `buildMlTrainingRow` -> `trimMlTrainingRowWindows(..., 5)` -> gRPC `Predict`.
- Это фиксирует одинаковую форму фич между train/backtest/prod.

## 5. BB moments

- Для `BB_Upper`, `BB_Middle`, `BB_Lower` добавлены статистики:
  - `_Mean`, `_Std`, `_Skew`, `_Kurt`.
- Считаются для всех TF и для обоих ассетов (`ALT`/`BTC`).

## 6. Исключения

- `POINTS_*` / `TOUCHES_*` не являются индикаторными candle-series и не должны удаляться как "последняя свеча".
- `entryTimestamp` остается в row для guard/аудита, но исключается из инференс-фичей.

## 7. Отчеты и проверки

- В итоговые train-отчеты добавляется TOP-10 признаков holdout:
  - markdown (`*.md`)
  - html (`*.report.html`)
- Unit-тесты:
  - `src/utils/__tests__/mlTrainingTransform.test.ts`
  - `src/utils/__tests__/mlGrpc.test.ts`
- Линт на неиспользуемые переменные/функции:
  - включен через `@typescript-eslint/no-unused-vars` в `.eslintrc.json`.
