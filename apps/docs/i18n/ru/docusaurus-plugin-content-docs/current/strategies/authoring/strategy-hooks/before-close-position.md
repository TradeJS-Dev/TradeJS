---
title: beforeClosePosition
---

Вызывается в exit-path перед `connector.closePosition(...)`.

## Параметры

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

## Выход

| Возврат                      | Тип                                                                                        | Эффект                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Разрешить/запретить закрытие | `{ allow?: boolean; reason?: string }` или `Promise<{ allow?: boolean; reason?: string }>` | Если `allow === false`, закрытие блокируется. |
| Без значения                 | `void` или `Promise<void>`                                                                 | Закрытие продолжается.                        |
