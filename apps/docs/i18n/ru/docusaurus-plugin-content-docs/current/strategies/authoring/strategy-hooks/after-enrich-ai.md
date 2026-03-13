---
title: afterEnrichAi
---

Вызывается в entry-path после AI enrichment.

## Вход (`params`)

| Поле                   | Тип                       | Описание                                   |
| ---------------------- | ------------------------- | ------------------------------------------ | ----------------------------------------- |
| `connector`            | `object`                  | Экземпляр коннектора биржи.                |
| `strategyName`         | `string`                  | Имя/идентификатор стратегии.               |
| `userName`             | `string`                  | Пользователь runtime.                      |
| `symbol`               | `string`                  | Текущий торговый символ.                   |
| `config`               | `Record<string, unknown>` | Разрешенный конфиг стратегии.              |
| `env`                  | `string`                  | Окружение, например `BACKTEST` или `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Конфиг получен из backtest payload.        |
| `decision`             | `EntryDecision`           | Entry-решение из `core.ts`.                |
| `runtime`              | `EntryRuntime             | undefined`                                 | Runtime overrides для этого entry.        |
| `signal`               | `Signal                   | undefined`                                 | Enriched signal snapshot (если доступен). |
| `quality`              | `number                   | undefined`                                 | AI quality score из анализа.              |

`EntryDecision`:

```ts
{
  kind: 'entry';
  code: string;
  entryContext: {
    strategy: string;
    symbol: string;
    interval: string;
    direction: 'LONG' | 'SHORT';
    timestamp: number;
    prices: {
      currentPrice: number;
      takeProfitPrice: number;
      stopLossPrice: number;
      riskRatio: number;
    };
    isConfigFromBacktest?: boolean;
  };
  orderPlan: {
    qty: number;
    stopLossPrice: number;
    takeProfits: Array<{ price: number; rate: number; done?: boolean }>;
  };
  runtime?: EntryRuntime;
  signal?: Signal;
}
```

`EntryRuntime`:

```ts
{
  ml?: { enabled?: boolean; strategyConfig?: Record<string, unknown>; mlThreshold?: number };
  ai?: { enabled?: boolean; minQuality?: number };
  beforePlaceOrder?: () => Promise<void>;
}
```

`Signal` (поля, используемые runtime):

```ts
{
  signalId: string;
  symbol: string;
  interval: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
  prices: {
    currentPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    riskRatio: number;
  };
  figures: Record<string, unknown>;
  indicators: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  ml?: { probability: number; threshold: number; passed: boolean };
}
```

## Выход

| Возврат      | Тип                        |
| ------------ | -------------------------- |
| Без значения | `void` или `Promise<void>` |

Этот хук не блокирует выполнение runtime.
