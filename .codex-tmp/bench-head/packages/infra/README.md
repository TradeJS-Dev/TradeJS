# @tradejs/infra

Server-only infrastructure adapters for the TradeJS open-source framework.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## Where It Fits

`@tradejs/infra` is not part of the basic authoring surface.

Most external users do not install it directly. It usually comes transitively through:

- `@tradejs/app`
- `@tradejs/cli`
- `@tradejs/node`

Install it directly only if you are building custom server/runtime integrations on top of TradeJS.

## Direct Install

```bash
npm i @tradejs/infra @tradejs/types
```

## Public Surface

Import only explicit subpaths:

- `@tradejs/infra/files`
- `@tradejs/infra/http`
- `@tradejs/infra/logger`
- `@tradejs/infra/ml`
- `@tradejs/infra/redis`
- `@tradejs/infra/timescale`

There is no root `@tradejs/infra` import surface.

## Usage

```ts
import { getData, setData } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
```

## Notes

- `@tradejs/infra` is server-only. Do not import it into browser/client code.
- Environment loading should happen in your app/runtime entrypoint, not inside shared library code.
- If you are following the standard external quickstart, start with `@tradejs/app`, `@tradejs/core`, `@tradejs/node`, `@tradejs/base`, and `@tradejs/cli` instead of adding `@tradejs/infra` manually.
