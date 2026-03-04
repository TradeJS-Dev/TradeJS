# StrategyAPI Reference

Updated for shared runtime and strategy `core.ts` usage.

## What `strategyApi` Is

`strategyApi` is the DSL object passed by shared runtime into `createCore(...)`.

Goals:

- reduce boilerplate in strategy cores
- provide consistent access to runtime context and helper logic

## Methods

### `strategyApi.skip(code)`

Returns a `skip` decision.

```ts
return strategyApi.skip('NO_SIGNAL');
```

### `strategyApi.entry(params)`

Builds an `entry` decision + signal through shared builders.

Common fields:

- `direction`
- `timestamp`
- `prices`
- `orderPlan`
- optional: `code`, `figures`, `indicators`, `additionalIndicators`, `runtime`, `signalId`

Behavior:

- if `code` is omitted, runtime uses `<STRATEGY_NAME>_SIGNAL`

### `strategyApi.getMarketData(params?)`

Returns market snapshot:

- `fullData`
- `lastCandle`
- `timestamp` (equal to `lastCandle.timestamp`)
- `currentPrice`

Uses runtime defaults unless overridden:

- `preloadStart`
- `backtestPriceMode`

### `strategyApi.getCurrentPosition()`

Wrapper for:

- `connector.getPosition(symbol)`

### `strategyApi.isCurrentPositionExists()`

Returns `true` when an open position exists (`qty > 0`).

### `strategyApi.getDirectionalTpSlPrices(params)`

Shared TP/SL/risk helper. Returns:

- `stopLossPrice`
- `takeProfitPrice`
- `riskRatio`
- `qty` (when `maxLossValue` is provided)

### `strategyApi.createLastTradeController(params?)`

Creates reusable trade cooldown state controller.

## Runtime Notes

- `getMarketData()` reads from runtime-managed candle history.
- `indicatorsState` is already wired with current bar by runtime.
- `indicatorsState.snapshot()` is lazy-init safe via shared wrappers.

## Typical `core.ts` Pattern

```ts
return async () => {
  const { currentPrice, timestamp } = await strategyApi.getMarketData();

  if (await strategyApi.isCurrentPositionExists()) {
    return strategyApi.skip('POSITION_EXISTS');
  }

  const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
    strategyApi.getDirectionalTpSlPrices({
      price: currentPrice,
      direction: 'LONG',
      takeProfitDelta: 2,
      stopLossDelta: 1,
      unit: 'percent',
    });

  if (!qty || qty <= 0) {
    return strategyApi.skip('INVALID_QTY');
  }

  return strategyApi.entry({
    direction: 'LONG',
    timestamp,
    prices: { currentPrice, takeProfitPrice, stopLossPrice, riskRatio },
    orderPlan: { qty, takeProfits: [{ rate: 1, price: takeProfitPrice }] },
  });
};
```
