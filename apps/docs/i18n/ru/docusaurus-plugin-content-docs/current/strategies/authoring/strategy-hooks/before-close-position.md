---
title: beforeClosePosition
---

Вызывается в exit-path перед `connector.closePosition(...)`.

## Вход (`params`)

| Поле                   | Тип                       | Описание                                   |
| ---------------------- | ------------------------- | ------------------------------------------ |
| `connector`            | `object`                  | Экземпляр коннектора биржи.                |
| `strategyName`         | `string`                  | Имя/идентификатор стратегии.               |
| `userName`             | `string`                  | Пользователь runtime.                      |
| `symbol`               | `string`                  | Текущий торговый символ.                   |
| `config`               | `Record<string, unknown>` | Разрешенный конфиг стратегии.              |
| `env`                  | `string`                  | Окружение, например `BACKTEST` или `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Конфиг получен из backtest payload.        |
| `decision`             | `ExitDecision`            | Exit-решение из `core.ts`.                 |

`ExitDecision`:

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

## Выход

| Возврат                      | Тип                                                                                        | Эффект                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Разрешить/запретить закрытие | `{ allow?: boolean; reason?: string }` или `Promise<{ allow?: boolean; reason?: string }>` | Если `allow === false`, закрытие блокируется. |
| Без значения                 | `void` или `Promise<void>`                                                                 | Закрытие продолжается.                        |
