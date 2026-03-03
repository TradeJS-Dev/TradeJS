# 📈 TradeJS — Trading Bot & Backtesting Framework

Этот репозиторий — универсальный фреймворк для запуска торговых стратегий, бэктеста и автоматизации через Node.js и Next.js.

---

## 🧩 Monorepo модули (Turbo)

- `apps/app` — Next.js приложение (UI + API).
- `packages/core` — ядро стратегий, runtime, типы и утилиты.
- `packages/connectors` — адаптеры бирж и market-data провайдеры.
- `packages/cli` — CLI-скрипты (`backtest`, `signals`, `bot`, `ml-*`, `doctor`).
- `packages/framework` — публичный TS-native слой для пользователей (контракты стратегий/сигналов без привязки к внутренней структуре).
- `packages/ml` — Python ML сервисы (train/infer/profile).

### Быстрый запуск локально

- Поднять инфраструктуру: `yarn infra-up`
- Проверить сервисы: `yarn doctor`
- Запустить app: `yarn dev`
- Запустить app + infra: `yarn dev:with-infra`

### Что устанавливает пользователь framework

- Пакет `@tradejs/framework` как внешнюю точку входа для TS-интеграции.
- Внутренние пакеты (`core`, `connectors`, `cli`, `app`) остаются implementation detail текущего репозитория.

---

## 📂 Общая структура `src/`

### **`actions/`**
Серверные действия (_server actions_) для:
- Загрузки исторических свечей (Kline)
- Запуска сканеров и стратегий  
**Пример:** модуль `kline` использует коннектор ByBit для получения котировок.

---

### **`connectors/`**
Интеграция с торговыми площадками:
- **`ByBit/`** — работа с REST API биржи ByBit (цены, ордера)
- **`Test/`** — тестовый коннектор для симуляции и бэктеста

---

### **`strategy/`**
Папки с торговыми стратегиями:
- `Breakout`, `Channel`, `ReversalPattern` и др.
- Стратегии приведены к более унифицированному формату:
  - `strategy.ts` — thin-wrapper,
  - `core.ts` — логика стратегии + сборка `entry`/`exit` decisions (`skip/entry/exit`),
  - `manifest.ts` — manifest стратегии (`name`, AI/ML adapters),
  - `adapters/` — strategy-specific AI/ML adapters (если нужны).
- Исполнение ордеров/AI/ML/runtime orchestration вынесено в общий слой (`src/utils/strategyRuntime.ts` + `src/utils/strategyHelpers/*`).
- `entry`-решения унифицированы:
  - `entryContext` (strategy/symbol/direction/timestamp/prices) — единый источник данных для сигнала и исполнения,
  - `orderPlan` — только execution-specific поля (`qty`, `takeProfits`),
  - `isConfigFromBacktest` — флаг, что итоговый config был подмешан из backtest result.
  - `strategyApi` (DSL в `core.ts`) закрывает типовой boilerplate (`skip`, `entry`, `getMarketData`, position helpers, TP/SL helper); `getMarketData()` возвращает `timestamp` (`lastCandle.timestamp`).
- Для `TrendLine` в live-режиме добавлен runtime AI-анализ сигнала:
  - анализируется уже собранный сигнал (индикаторы + BTC + трендовая линия),
  - AI сохраняет результат в Redis (`analysis:*`),
  - ордер открывается только если AI подтверждает текущее направление и ставит `quality` 4-5.
- Все стратегии перечислены в индексе.
- Отдельный API/контракты стратегий описаны в `STRATEGY_API.md`.
- Отдельный reference по методам `strategyApi` — `STRATEGY_API_REFERENCE.md`.

---

### **`scripts/`**
Node-скрипты для автоматизации:
- **`backtest.ts`** — массовый запуск бэктестов с разными параметрами.
- **`bot.ts`** — периодический запуск стратегий по конфигурационному файлу.
- **`signals.ts`** — поиск сигналов + скриншоты + Telegram-уведомления; AI-анализ для TrendLine теперь вызывается в самой стратегии (а не отдельным этапом скрипта).

---

### **`workers/`**
Фоновые воркеры:
- Например, **`tester.ts`** для параллельного бэктеста.

---

### **`utils/`**
Утилиты:
- Логирование (`logger.ts`) — на базе Winston.
- Работа с файлами (`data.ts`).
- Генерация параметров (`generateParamGrid`).
- Общие helper'ы стратегий:
  - `strategyRuntime.ts` — общий runtime для стратегий,
  - `strategyHelpers/` — config/indicator/market/signal-builder/runtime helper'ы.
- Strategy-aware AI/ML:
  - общий pipeline живет в `ai.ts` / `mlPayload.ts` / `mlGrpc.ts`,
  - strategy-specific расширения берутся из strategy manifest/adapters (`src/strategy/*/manifest.ts`, `src/strategy/*/adapters/*`).
- Подсчет результатов и другие вспомогательные функции.

---

### **`app/`**
Фронтенд на Next.js:
- Управление состоянием — zustand
- Компоненты интерфейса — **Chakra UI**.
- Главная страница — топ тикеров, список бэктестов, графики индикаторов.

---

## ⚙️ Основные файлы и понятия

- **Конфиги:**  
  - `bot.config.ts` — параметры «живого» бота.
  - `backtest.config.ts` — сетки параметров для массового тестирования.

- **Интерфейсы коннекторов:**  
  Описаны в `src/types/index.ts` — методы вроде `kline`, `placeOrder`, `closePosition`.

- **Логи и данные:**  
  - Логирование — `src/utils/logger.ts`.  
  - Чтение/запись JSON — `src/utils/data.ts`.

- **Крон-джоб:**  
  Вызывает `/api/cron`, который запускает `runBot` — загружает данные и применяет стратегии к тикерам.

---

## 🚀 Что изучить новичку

👉 Рекомендуется начать с:
- **Коннекторов:** `src/connectors/ByBit` и `src/connectors/Test` — понять, как работает общение с биржей или симулятором.
- **Стратегий:** `src/strategy/*` — логика открытия/закрытия сделок.
- **Бэктеста:** `src/scripts/backtest.ts` + воркер `src/workers/tester.ts`.
- **Интерфейса:** компоненты `src/app/components` — графики и результаты.
- **Утилиты:** генератор параметров `src/utils/grid.ts`, система подсчета результатов `src/utils/results.ts`.

---

## ✅ Итог

Этот проект — готовая основа для:
- Автоматизированной торговли
- Массового тестирования гипотез
- Визуализации торговых данных

> Разбирайтесь по частям, экспериментируйте с конфигами и улучшайте стратегии!

---

## 🧠 ML Pipeline (обновлено 2026-02-18)

- `yarn backtest` пишет ML-строки в chunk-файлы:
  - `ml-dataset-[strategy]-[chunkId].jsonl`
- `yarn ml-export` только объединяет chunk -> merged JSONL.
- Train режет merged-файл на:
  - `holdout-train`, `holdout-test`, `prod`, `walk-forward fold train/test`.
- Обучение идет только по `*.train.*`, оценка только по `*.test.*`.
- В `mlTrainingTransform`:
  - последний элемент всех массивов индикаторов/свечей удаляется перед фичами,
  - рабочее окно строится как `ML_BASE_CANDLES_WINDOW - 1`,
  - финальный output всегда режется до последних 5 значений (`trimMlTrainingRowWindows`).
- Нейминг фич унифицирован:
  - `TF*_ALT_*` для текущей монеты,
  - `TF*_BTC_*` для BTC.
- Для Bollinger Bands добавлены моменты по каждому TF и для обоих ассетов:
  - `_Mean`, `_Std`, `_Skew`, `_Kurt`.
- Тот же `trim(..., 5)` применяется и в inference (`mlGrpc`), чтобы train/backtest/prod использовали одинаковую схему фичей.
- Это не то же самое, что runtime AI-анализ сигналов: LLM получает runtime payload с сырыми именами индикаторов (`maFast`, `btcMaFast1h`, `candles15m` и т.п.), где ряды также режутся до 5 значений; для UI базовый формат фигур унифицирован (`figures.lines/points/zones`), legacy `figures.trendLine` при чтении нормализуется в этот формат.
- В отчетах train теперь есть TOP-10 holdout признаков (single-feature threshold):
  - и в `*.md`,
  - и в `*.report.html`.

---

**📌 Happy Trading with TradeJS!**
