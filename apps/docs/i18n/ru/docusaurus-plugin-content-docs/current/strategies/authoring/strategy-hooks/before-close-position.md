---
title: beforeClosePosition
---

Вызывается на exit path перед `connector.closePosition(...)`.

## Params

```ts
{
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  };
  decision: ExitDecision;
}
```

## Output

| Возврат              | Тип                                                                                      | Эффект                                             |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Разрешить/запретить  | `{ allow?: boolean; reason?: string }` или `Promise<{ allow?: boolean; reason?: string }>` | Если `allow === false`, закрытие блокируется.      |
| Без return value     | `void` или `Promise<void>`                                                                | Закрытие продолжается.                             |

Когда gate блокирует исполнение (`allow === false`), runtime возвращает `CLOSE_BLOCKED_BY_HOOK:${reason}` или `CLOSE_BLOCKED_BY_HOOK`.
