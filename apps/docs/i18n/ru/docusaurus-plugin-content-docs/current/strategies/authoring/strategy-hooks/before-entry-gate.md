---
title: beforeEntryGate
---

Вызывается на entry path после вычисления standard runtime policy checks и до постановки ордера. Этот хук вызывается для всех entry решений, включая no-signal entries.

## Params

```ts
{
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  };
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
}
```

`policy.aiQuality` равен `undefined`, когда сигнала нет или AI не вернул quality score.

## Output

| Возврат              | Тип                                                                                      | Эффект                                             |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Разрешить/запретить  | `{ allow?: boolean; reason?: string }` или `Promise<{ allow?: boolean; reason?: string }>` | Если `allow === false`, вход блокируется.          |
| Без return value     | `void` или `Promise<void>`                                                                | Вход продолжается.                                 |

Когда gate блокирует исполнение (`allow === false`):

- Если существует `entry.signal`, runtime ставит `signal.orderStatus = 'skipped'` и `signal.orderSkipReason = 'HOOK_BEFORE_ENTRY_GATE:${reason}'` или `HOOK_BEFORE_ENTRY_GATE`.
- Если сигнала нет, runtime возвращает строку `HOOK_BEFORE_ENTRY_GATE:${reason}` или `HOOK_BEFORE_ENTRY_GATE`.
