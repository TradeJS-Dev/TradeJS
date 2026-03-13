---
title: beforeClosePosition
---

Вызывается в exit-path перед `connector.closePosition(...)`.

## Параметры

```ts
{
  connector: {
    kline: (params: unknown) => Promise<unknown>;
    getState: () => Promise<Record<string, unknown>>;
    setState: (state: object) => Promise<void>;
    getPosition: (symbol?: string) => Promise<unknown>;
    getPositions: () => Promise<unknown[]>;
    placeOrder: (...args: unknown[]) => Promise<unknown>;
    closePosition: (params: unknown) => Promise<unknown>;
    getTickers: () => Promise<unknown[]>;
  };
  strategyName: string;
  userName: string;
  symbol: string;
  config: Record<string, unknown>;
  env: string;
  isConfigFromBacktest: boolean;
  decision: {
    kind: 'exit';
    code: string;
    closePlan: {
      price: number;
      timestamp: number;
      direction: 'LONG' | 'SHORT';
    };
  };
}
```

## Выход

| Возврат                      | Тип                                                                                        | Эффект                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Разрешить/запретить закрытие | `{ allow?: boolean; reason?: string }` или `Promise<{ allow?: boolean; reason?: string }>` | Если `allow === false`, закрытие блокируется. |
| Без значения                 | `void` или `Promise<void>`                                                                 | Закрытие продолжается.                        |
