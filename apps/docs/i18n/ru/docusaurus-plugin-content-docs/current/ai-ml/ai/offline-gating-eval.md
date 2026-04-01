---
title: Оффлайн-оценка AI-гейтинга
---

Перед изменением AI-gating логики оцените эффект оффлайн, без влияния на live-исполнение.

## Цель

Понять, как новая policy влияет на покрытие сигналов и ожидаемое качество.

## Какие данные нужны

- Исторические сигналы с известным outcome
- AI-ответы (сохраненные или воспроизводимые)
- Метаданные стратегии (`symbol`, `direction`, `interval`)

## Воспроизводимый CLI flow

```bash
npx @tradejs/cli backtest --config TrendLine:base --ai
npx @tradejs/cli ai-export
npx @tradejs/cli ai-train -n 50 --minQuality 4
```

Артефакты:

- `backtest --ai` пишет `data/ai/export/ai-dataset-<strategy>-chunk-<chunkId>.jsonl`
- `ai-export` объединяет их в `data/ai/export/ai-dataset-<strategy>-merged-<timestamp>.jsonl`
- `ai-train` по умолчанию воспроизводит prompt-ы из последнего merged-файла

Полезные флаги `ai-train`:

- `-n, --recent` — проверить последние N сделок с конца (`0` = все строки)
- `--minQuality` — минимальный quality threshold для AI approval
- `-s, --strategy` — взять последний merged-файл только для одной стратегии
- `-f, --file` — воспроизвести конкретный merged dataset файл

Как `ai-train` считает approval:

- сделка считается одобренной только если AI вернул то же направление, что и исходный сигнал, и `quality >= minQuality`
- корректность оффлайн считается по фактическому результату сделки (`profit > 0`)

## Ключевые метрики

- approval rate
- precision по quality-бакетам
- влияние на expectancy proxy
- доля конфликтов с направлением стратегии
- `tp / fp / tn / fn` для approval против реальной прибыльности

## Как проводить оценку

1. Прогон baseline policy.
2. Прогон candidate policy.
3. Сравнение tradeoff: coverage vs quality.
4. Промоушен только при устойчивом улучшении.

## После релиза

Выпускайте изменения постепенно и следите за drift в проде.
