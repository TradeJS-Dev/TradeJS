---
title: Проверка ML-датасета
---

`yarn ml-inspect` помогает проверить качество датасета до обучения.

Источник:

- `packages/cli/src/scripts/mlInspect.ts`

## Быстрый старт

```bash
yarn ml-inspect
yarn ml-inspect --strategy TrendLine --rows 20000 --mode sample
yarn ml-inspect --file data/ml/export/ml-dataset-trendline-merged-123.jsonl --mode tail
```

## Режимы

- `head`: первые N строк
- `tail`: последние N строк
- `sample`: случайная выборка (reservoir sample)

## Инструменты инспекции

- `quick` (по умолчанию): встроенная числовая диагностика
- `ydata`: HTML-отчет профилирования через Docker (`ml-profile`)

Примеры:

```bash
yarn ml-inspect --tool quick --rows 15000
yarn ml-inspect --tool ydata --rows 20000 --mode sample
```

## Что проверяет quick-режим

Для numeric полей считает и помечает:

- долю missing/non-finite
- почти константные признаки
- mostly-zero признаки
- долю выбросов
- масштабный разброс (`p99/median` и отличие от общего масштаба)

Выводит топ проблемных полей по score и подсказки по исправлению.

## Вывод ydata

`ydata` режим генерирует:

- `<dataset-name>.profile.html` рядом с исходным файлом

Требование:

```bash
docker compose -f docker-compose.ml.yml build ml-profile
```

## Полезные флаги

- `--dir data/ml/export`
- `--strategy <Strategy>`
- `--file <explicit path>`
- `--rows <N>`
- `--mode head|tail|sample`
- `--limitIssues <N>`
- `--minFieldValues <N>`
- `--tool quick|ydata`
