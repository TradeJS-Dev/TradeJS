---
title: beforeClosePosition
---

Called on exit path before `connector.closePosition(...)`.

## Params

```ts
{
  connector: Connector;
  strategyName: string;
  userName: string;
  symbol: string;
  config: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
  decision: {
    kind: 'exit';
    code: string;
    closePlan: {
      price: number;
      timestamp: number;
      direction: 'LONG' | 'SHORT';
    }
  }
}
```

## Output

| Return           | Type                                                                                      | Effect                                            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Allow/deny close | `{ allow?: boolean; reason?: string }` or `Promise<{ allow?: boolean; reason?: string }>` | If `allow === false`, close execution is blocked. |
| No return value  | `void` or `Promise<void>`                                                                 | Close execution continues.                        |
