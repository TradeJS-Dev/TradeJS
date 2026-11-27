# @tradejs/node

Run TradeJS strategies in Node.js, test them on historical data, and
connect the plugins that supply data and manage trades.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## License

Version 2.0.0 and later is licensed under Business Source License 1.1. The
Additional Use Grant permits internal and other non-competing production use;
providing a competing product or service requires a commercial license.
Earlier releases remain MIT-licensed. See the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## Where It Fits

`@tradejs/node` is the server/runtime half of TradeJS.

Use it together with:

- `@tradejs/core` for browser-safe/public authoring helpers
- `@tradejs/types` for shared contracts
- `@tradejs/cli` for operational commands
- `@tradejs/app` if you want the installable web UI

## Standard External Install Flow

In a normal external TradeJS project you usually install the full runtime set:

```bash
npm i @tradejs/app @tradejs/core @tradejs/node @tradejs/types @tradejs/base @tradejs/cli
```

And create `tradejs.config.ts` in project root:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset);
```

## What It Provides

`@tradejs/node` contains server-only runtime helpers that do not belong in browser-safe `@tradejs/core`:

- strategy runtime execution
- connector/plugin registries
- backtest orchestration helpers
- Pine-backed strategy loading/runtime helpers
- runtime-side operational helpers used by CLI/app

## Trade management plugins

These plugins add rules that TradeJS can run during execution. Their
Marketplace pages show how to configure them.

- [Move stop to break-even](https://tradejs.dev/marketplace/break-even)
  moves the stop toward entry after a position has moved far enough in its
  favor.
- [Close on global profit](https://tradejs.dev/marketplace/global-profit)
  requests closure of open positions when their combined unrealized profit
  reaches the configured threshold.
- [Close opposite positions](https://tradejs.dev/marketplace/opposite-positions)
  can request closure of positions in the opposite direction on other symbols
  before a new order goes out on the same account.

## Public Surface

Import only explicit subpaths:

- `@tradejs/node/strategies`
- `@tradejs/node/backtest`
- `@tradejs/node/pine`
- `@tradejs/node/registry`
- `@tradejs/node/connectors`
- `@tradejs/node/cli`
- `@tradejs/node/constants`
- `@tradejs/node/runtimeTrades`
- `@tradejs/node/runtimeDashboard`

There is no root `@tradejs/node` import surface.

## Minimal Example

```ts
import { createStrategyRuntime } from '@tradejs/node/strategies';
```

## Notes

- `@tradejs/node` is server-only.
- Do not import it into browser/client bundles.
- For plugin/config declaration and browser-safe helpers, use `@tradejs/core`.
- For shared contracts, use `@tradejs/types`.

Keywords: ai, claude, codex.

## Восстановление входа Bybit после сбоя

После `ENTRY_RECOVERY_REQUIRED` новые входы по счёту и инструменту остаются
заблокированными. API ниже доступен в исходниках этой версии. Для установленного
приложения сначала нужен выпуск с этим API.

1. Остановите все процессы, способные отправлять запросы по этому счёту и
   инструменту, на всех хостах: `signals-daemon`, `bot`, запуски из cron,
   другие экземпляры приложения и собственные скрипты. Приостановите их
   автоматический перезапуск и ручную торговлю. Проверьте в менеджере процессов
   или контейнеров, что отправители остановлены.
2. Дождитесь завершения ранее начатых запросов создания, отмены и закрытия
   ордеров, изменения leverage и защиты позиции. Проверьте их исходы по
   журналам отправителей и состоянию биржи. Если остановку отправителей или
   завершение запросов подтвердить нельзя, восстановление запускать нельзя.
3. В отдельном административном процессе используйте тот же подключённый
   коннектор, Redis, имя пользователя и инструмент. Прочитайте запись и передайте
   её точное значение в API:

```ts
import {
  inspectEntryOrderSafety,
  recoverEntryOrderSafety,
} from '@tradejs/node/strategies';

const context = { connector, userName: 'your-user', symbol: 'BTCUSDT' };
const expectedClaim = await inspectEntryOrderSafety(context);
if (expectedClaim !== null) {
  await recoverEntryOrderSafety({
    ...context,
    expectedClaim,
    writersStopped: true,
  });
}
```

`writersStopped: true` означает подтверждение выполненных шагов оператором.
API не останавливает процессы и не блокирует запросы на стороне биржи.

API только читает состояние биржи. Для каждого отправленного входного и
закрывающего ордера нужно конечное состояние, а свежий ответ о позиции должен
подтверждать её отсутствие. После проверки API атомарно освобождает только
прочитанную запись и сохраняет подтверждение закрытия для портфеля. Если запись
успела измениться, освобождения не будет. Полная запись v2 до первой отправки
также освобождается после подтверждения отсутствия позиции. Журнал доказывает,
что запрос ордера ещё не отправлялся, и API сохраняет подтверждение нулевого
исполнения для точного ID резерва портфеля. Такая же проверка доступна после
допуска нового ID портфелем до отправки ордера. Успешное завершение функции разрешает
возобновить отправители. Открытая позиция, даже со стопом, не освобождает запись.

При недоступности биржи или Redis, неизвестном ордере, старой записи v1 или
неполном журнале блокировка сохраняется. Срока автоматического снятия нет.
Не удаляйте запись вручную. Такие случаи требуют отдельного расследования;
API не восстанавливает недостающие доказательства и не отправляет новые ордера.
