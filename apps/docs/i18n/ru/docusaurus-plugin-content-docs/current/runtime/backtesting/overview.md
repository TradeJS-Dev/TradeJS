---
sidebar_position: 8
title: Как работают бэктесты
---

## Точка входа

```bash
npx @tradejs/cli backtest
```

Требование к локальной инфраструктуре:

```bash
npx @tradejs/cli infra-init
npx @tradejs/cli infra-up
```

`infra-init` создает `docker-compose.dev.yml` один раз и сохраняет пользовательские изменения, если файл уже есть.
`infra-up` поднимает Redis + PostgreSQL/Timescale на основе этого файла.
После работы инфраструктуру можно остановить через `npx @tradejs/cli infra-down`.

Основные файлы:

- CLI-скрипт: `@tradejs/cli`
- runtime воркера: `@tradejs/node`

## Реальные CLI-флаги (из кода)

```ts
args.option(['c', 'config'], 'Backtest config', 'breakout');
args.option(['n', 'tests'], 'Tests limit', TESTS_LIMIT);
args.option(['p', 'parallel'], 'Parallel tasks', MAX_PARALLEL);
args.option('connector', 'Connector/provider', 'bybit');
args.option(['m', 'ml'], 'Write ML dataset rows', false);
args.option(['A', 'ai'], 'Write AI prompt rows', false);
```

Пример запуска для TrendLine-подобного сценария:

```bash
npx @tradejs/cli backtest --config trendline --connector bybit --tests 500 --parallel 4 --ml --ai
```

## Пайплайн

1. Читается backtest config из Redis (`users:<user>:backtests:configs:<config>`).
2. Загружаются тикеры.
3. При необходимости обновляются свечи.
4. Собирается test suite (комбинации параметров).
5. Набор делится на чанки и обрабатывается воркерами.
6. Собирается финальная статистика.

## Реальный паттерн worker-обработки

```ts
import { testing } from '@tradejs/node/backtest';

for await (const test of testSuite) {
  const testResult = await testing(test);
  process.send?.({
    stat: testResult.stat,
    orderLogId: testResult.orderLogId,
    test,
  });
}
```

## ML-датасет в процессе бэктеста

```bash
npx @tradejs/cli backtest --ml
```

Создаются chunk-файлы:

- `ml-dataset-<strategy>-chunk-<chunkId>.jsonl`

Потом они объединяются:

```bash
npx @tradejs/cli ml-export
```

## AI prompt-датасет в процессе бэктеста

```bash
npx @tradejs/cli backtest --ai
```

Создаются chunk-файлы:

- `ai-dataset-<strategy>-chunk-<chunkId>.jsonl`

Потом их можно объединить и прогнать оффлайн:

```bash
npx @tradejs/cli ai-export
npx @tradejs/cli ai-train -n 50 --minQuality 4
```

## Замечание про UI

Встроенное Next.js-приложение пока не поставляется как публичный внешний пакет.
Для внешнего пользователя поддерживаемый сценарий бэктеста сейчас CLI-first.

## Связанные статьи

- [Grid-конфиг бэктеста для массового перебора параметров](./grid-config)
- [Результаты бэктеста -> runtime-конфиг](./results-runtime-config)
- [Data Sync](../../getting-started/data-sync)
