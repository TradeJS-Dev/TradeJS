---
title: beforeClosePosition
---

Called on exit path before `connector.closePosition(...)`.

## Input (`params`)

| Field                  | Type                      | Description                                    |
| ---------------------- | ------------------------- | ---------------------------------------------- |
| `connector`            | `object`                  | Exchange connector instance.                   |
| `strategyName`         | `string`                  | Strategy id/name.                              |
| `userName`             | `string`                  | Runtime user.                                  |
| `symbol`               | `string`                  | Current market symbol.                         |
| `config`               | `Record<string, unknown>` | Resolved strategy config.                      |
| `env`                  | `string`                  | Environment, for example `BACKTEST` or `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Whether config came from backtest payload.     |
| `decision`             | `ExitDecision`            | Exit decision from `core.ts`.                  |

`ExitDecision` shape:

```ts
{
  kind: 'exit';
  code: string;
  closePlan: {
    price: number;
    timestamp: number;
    direction: 'LONG' | 'SHORT';
  }
}
```

## Output

| Return           | Type                                                                                      | Effect                                            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Allow/deny close | `{ allow?: boolean; reason?: string }` or `Promise<{ allow?: boolean; reason?: string }>` | If `allow === false`, close execution is blocked. |
| No return value  | `void` or `Promise<void>`                                                                 | Close execution continues.                        |
