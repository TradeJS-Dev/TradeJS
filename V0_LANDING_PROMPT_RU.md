# Prompt for v0.app (RU)

Скопируй текст ниже в `v0.app` без изменений.

---

Ты senior product designer + senior frontend engineer.

Нужно сгенерировать **красивый, современный, продающий, production-ready одностраничный лендинг** для проекта **TradeJS**.

## Контекст продукта

TradeJS — это фреймворк для:
- создания торговых стратегий,
- бэктестов,
- запуска сигналов и торговых сценариев в рантайме,
- AI/ML-усиления сигналов.

Ключевая идея: разработчик может писать стратегии и индикаторы как на **TypeScript**, так и на **Pine Script**.

## Жесткие требования

1. Лендинг должен быть **одностраничным**.
2. Должен быть **переключатель языков RU/EN** (в шапке, заметный).
3. Должна быть большая заметная кнопка **Get Started** (primary CTA), ведущая на:
   - `https://aleksnick01inv.fvds.ru`
4. Должна быть кнопка/ссылка на документацию:
   - `https://docs.aleksnick01inv.fvds.ru/`
5. В блоке преимуществ каждый пункт должен иметь ссылку **Learn more / Подробнее** на соответствующую статью из docs (см. exact links ниже).
6. Адаптивность обязательна: mobile/tablet/desktop.
7. Не использовать заглушки вида “Lorem ipsum”. Контент должен быть осмысленным и готовым к публикации.

## Визуальный стиль (обязательно)

Сделай стиль в цветах торгового интерфейса (dark trading terminal):
- фон: очень темный сине-графитовый,
- акцент: бирюзово-циановый,
- bearish/риск: красный,
- дополнительные холодные синие оттенки,
- **не использовать фиолетовую палитру**.

Используй палитру:
- `--bg: #090d14`
- `--surface: #111826`
- `--surface-2: #131f31`
- `--text: #d5ddee`
- `--text-muted: #9cb0c7`
- `--accent: #20c5bd`
- `--accent-hover: #34d1c9`
- `--success: #19c6a0`
- `--danger: #ff5f70`
- `--info: #4ca9ff`
- `--border: #22364a`

Дополнительно:
- subtle grid/line pattern на фоне (ассоциация с графиком),
- аккуратные glow-акценты вокруг CTA,
- контрастный readability-first дизайн,
- современная типографика (например `Manrope` + `JetBrains Mono`),
- плавные, но ненавязчивые анимации появления блоков.

## Структура страницы

Собери страницу из следующих секций:

1. **Header**
- логотип/название `TradeJS`
- навигация по якорям секций
- language toggle `RU | EN`
- кнопка `Get Started`

2. **Hero**
- сильный value proposition
- подзаголовок про TS + Pine + Backtests + Runtime + AI/ML
- CTA-кнопки: `Get Started` и `Open Docs`
- короткий trust-блок (например: Backtesting, Runtime Signals, AI/ML, Telegram)

3. **Core Advantages** (главный продающий блок)
Покажи карточки преимуществ с иконками, кратким описанием и ссылкой на docs.

4. **How It Works**
3-4 шага: Create strategy -> Run grid backtests -> Promote best configs -> Run signals with notifications.

5. **Developer Experience**
Короткие code-snippet блоки (TS + Pine) для демонстрации dual authoring.

6. **Final CTA**
Повторный сильный call-to-action:
- primary: `Get Started`
- secondary: `Read Documentation`

7. **Footer**
- TradeJS
- ссылки: app + docs
- language switch duplication (опционально)

## Обязательные преимущества и ссылки на статьи

Сделай именно эти преимущества и привяжи каждый к статьям.

### 1) Стратегии/индикаторы на TypeScript
EN:
- `https://docs.aleksnick01inv.fvds.ru/strategies/authoring/write-strategies`
- `https://docs.aleksnick01inv.fvds.ru/indicators/authoring`
RU:
- `https://docs.aleksnick01inv.fvds.ru/ru/strategies/authoring/write-strategies`
- `https://docs.aleksnick01inv.fvds.ru/ru/indicators/authoring`

### 2) Совместимость с Pine Script
EN:
- `https://docs.aleksnick01inv.fvds.ru/strategies/authoring/pine-strategy-step-by-step`
- `https://docs.aleksnick01inv.fvds.ru/indicators/pine`
RU:
- `https://docs.aleksnick01inv.fvds.ru/ru/strategies/authoring/pine-strategy-step-by-step`
- `https://docs.aleksnick01inv.fvds.ru/ru/indicators/pine`

### 3) Локальный запуск и self-hosted
EN:
- `https://docs.aleksnick01inv.fvds.ru/getting-started/local`
- `https://docs.aleksnick01inv.fvds.ru/getting-started/self-hosted`
RU:
- `https://docs.aleksnick01inv.fvds.ru/ru/getting-started/local`
- `https://docs.aleksnick01inv.fvds.ru/ru/getting-started/self-hosted`

### 4) Встроенный AI / ML функционал
EN:
- `https://docs.aleksnick01inv.fvds.ru/ai-ml/ai/configuration`
- `https://docs.aleksnick01inv.fvds.ru/ai-ml/ml/configuration`
RU:
- `https://docs.aleksnick01inv.fvds.ru/ru/ai-ml/ai/configuration`
- `https://docs.aleksnick01inv.fvds.ru/ru/ai-ml/ml/configuration`

### 5) Массовые бэктесты через grid config
EN:
- `https://docs.aleksnick01inv.fvds.ru/runtime/backtesting/grid-config`
RU:
- `https://docs.aleksnick01inv.fvds.ru/ru/runtime/backtesting/grid-config`

### 6) Применение лучших тестов в рантайме
EN:
- `https://docs.aleksnick01inv.fvds.ru/runtime/backtesting/results-runtime-config`
RU:
- `https://docs.aleksnick01inv.fvds.ru/ru/runtime/backtesting/results-runtime-config`

### 7) Telegram-нотификации
EN:
- `https://docs.aleksnick01inv.fvds.ru/runtime/execution/telegram-notifications`
RU:
- `https://docs.aleksnick01inv.fvds.ru/ru/runtime/execution/telegram-notifications`

## Локализация (важно)

Сделай полноценное переключение RU/EN для:
- headline/subheadline,
- навигации,
- названий и описаний преимуществ,
- подписей кнопок,
- текста секций,
- ссылок на статьи (RU ссылки при RU, EN ссылки при EN).

## Технические требования к результату

- Используй React + Tailwind (в формате, который обычно генерирует v0).
- Сделай чистую компонентную структуру.
- Добавь basic SEO:
  - title,
  - description,
  - OpenGraph title/description.
- Добавь хорошую доступность (контраст, aria-label у toggle и CTA).

## Tone of Voice

B2B tech + quant/dev аудитория:
- конкретно,
- уверенно,
- без маркетинговой «воды».

## Что нужно вернуть

Верни **готовую страницу** (полный код компонента), которую можно сразу вставить в проект и использовать как landing page.

---
