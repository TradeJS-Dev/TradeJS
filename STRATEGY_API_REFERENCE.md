# StrategyAPI Reference

Актуально для shared runtime (`src/utils/strategyRuntime.ts`) и `core.ts` стратегий.

## Что такое `strategyApi`

`strategyApi` — это DSL-объект, который shared runtime передает в `createCore(...)`.

Цель:
- убрать boilerplate из `core.ts`
- дать стратегии доступ к runtime/context без ручного проброса одинаковых полей

## Методы

### `strategyApi.skip(code)`

Возвращает `StrategyDecision` вида `skip`.

Пример:

```ts
return strategyApi.skip('NO_SIGNAL');
```

### `strategyApi.entry(params)`

Собирает `entry`-решение и `signal` через shared builder.

Что передает стратегия:
- `direction`
- `timestamp`
- `prices`
- `figures`
- `indicators`
- `additionalIndicators`
- `orderPlan`
- `runtime` (optional)
- `code` (optional)

Особенности:
- если `code` не передан, по умолчанию используется `<STRATEGY_NAME>_SIGNAL`
  - пример: `TrendLine` -> `TRENDLINE_SIGNAL`

### `strategyApi.getMarketData(params?)`

Возвращает market snapshot:
- `fullData`
- `lastCandle`
- `currentPrice`

По умолчанию использует runtime context:
- `symbol`
- `interval`
- `connector`
- `cachedData` (тот же массив, который runtime обновляет на каждом баре)
- `preloadStart` (framework default)
- `BACKTEST_PRICE_MODE` из config

Можно переопределить:
- `preloadStart`
- `backtestPriceMode`

Пример:

```ts
const { fullData, lastCandle, currentPrice } = await strategyApi.getMarketData();
```

### `strategyApi.getCurrentPosition()`

Обертка над:

```ts
await connector.getPosition(symbol)
```

### `strategyApi.isCurrentPositionExists()`

Возвращает `true`, если по текущему `symbol` есть открытая позиция (`qty > 0`).

Пример:

```ts
if (await strategyApi.isCurrentPositionExists()) {
  return strategyApi.skip('POSITION_EXISTS');
}
```

### `strategyApi.getDirectionalTpSlPrices(params)`

Shared helper для расчета:
- `stopLossPrice`
- `takeProfitPrice`
- `riskRatio`
- `qty` (если передан `maxLossValue`)

### `strategyApi.createLastTradeController(params?)`

Создает controller для cooldown по последней сделке.

Обычно используется без аргументов:
- `env` берется из runtime context
- default cooldown policy задается в shared helper

## Замечания

- `strategyApi.getMarketData()` в `BACKTEST` читает `cachedData` по ссылке.
  Это значит, что при добавлении новых свечей runtime-ом следующий вызов увидит обновленный массив.
- `indicatorsState` также приходит в `core.ts` готовым из runtime; runtime на каждом баре передает в него текущую свечу через `setCurrentBar(...)`, поэтому можно вызывать `indicatorsState.onBar()` без аргументов.
- `indicatorsState.snapshot()` сам выполняет lazy-init (через shared wrapper), поэтому в типовых кейсах не нужен отдельный вызов `ensureInitializedWithCurrentBar()`.
