# TradeJS Repository Ownership

TradeJS is a multi-repository system. Repository ownership, not package import
location, decides where a change belongs.

## Platform repositories

| Repository                                                                            | Owns                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TradeJS](https://github.com/TradeJS-Dev/TradeJS)                                     | Framework engine, public runtime packages, UI package, CLI, indicators, connectors, ML implementation, and strategy-neutral research tooling                                                                              |
| [TradeJS-Base](https://github.com/TradeJS-Dev/TradeJS-Base)                           | Non-empty `@tradejs/base` preset and the default public plugin composition                                                                                                                                                |
| [TradeJS-Strategy-Kit](https://github.com/TradeJS-Dev/TradeJS-Strategy-Kit)           | Strategy-neutral `@tradejs/strategy-kit/*` authoring helpers                                                                                                                                                              |
| [TradeJS-Strategy-Template](https://github.com/TradeJS-Dev/TradeJS-Strategy-Template) | Template for new strategy repositories                                                                                                                                                                                    |
| [TradeJS-Workflows](https://github.com/TradeJS-Dev/TradeJS-Workflows)                 | Reusable CI plus beta-first and weekly stable npm publication workflows                                                                                                                                                   |
| [TradeJS-Project](https://github.com/TradeJS-Dev/TradeJS-Project)                     | Generated personal project, exact package composition, weekly batched stable-package sync, `tradejs.config.ts`, secret-free runtime defaults, local Compose, ignored `data/` and `notes/`, app image, and deploy dispatch |
| [TradeJS-Deploy](https://github.com/TradeJS-Dev/TradeJS-Deploy)                       | Production Compose, SSH, TLS, persistent volumes, server secrets, resource limits, and rollout lifecycle                                                                                                                  |
| [TradeJS-Docs](https://github.com/TradeJS-Dev/TradeJS-Docs)                           | Public knowledge base at `docs.tradejs.dev`                                                                                                                                                                               |
| [TradeJS-Site](https://github.com/TradeJS-Dev/TradeJS-Site)                           | Public site at `tradejs.dev`                                                                                                                                                                                              |

## Strategy repositories

Each repository below publishes one npm package and owns its tests, release,
README, and agent instructions.

| Repository                                       | npm package                                         | Strategies                     |
| ------------------------------------------------ | --------------------------------------------------- | ------------------------------ |
| `TradeJS-Strategy-AdaptiveMomentumRibbon`        | `@tradejs/strategy-adaptive-momentum-ribbon`        | AdaptiveMomentumRibbon         |
| `TradeJS-Strategy-AdaptiveTrendChannel`          | `@tradejs/strategy-adaptive-trend-channel`          | AdaptiveTrendChannel           |
| `TradeJS-Strategy-Breakout`                      | `@tradejs/strategy-breakout`                        | Breakout                       |
| `TradeJS-Strategy-CupAndHandle`                  | `@tradejs/strategy-cup-and-handle`                  | CupAndHandle                   |
| `TradeJS-Strategy-DoubleTap`                     | `@tradejs/strategy-double-tap`                      | DoubleTap                      |
| `TradeJS-Strategy-Dragon`                        | `@tradejs/strategy-dragon`                          | Dragon                         |
| `TradeJS-Strategy-Grid`                          | `@tradejs/strategy-grid`                            | Grid                           |
| `TradeJS-Strategy-GridClassic`                   | `@tradejs/strategy-grid-classic`                    | GridClassic                    |
| `TradeJS-Strategy-HeadAndShoulders`              | `@tradejs/strategy-head-and-shoulders`              | HeadAndShoulders               |
| `TradeJS-Strategy-HyperliquidConsensus`          | `@tradejs/strategy-hyperliquid-consensus`           | HyperliquidConsensus           |
| `TradeJS-Strategy-LiquidityTails`                | `@tradejs/strategy-liquidity-tails`                 | LiquidityTails                 |
| `TradeJS-Strategy-LiquidityZones`                | `@tradejs/strategy-liquidity-zones`                 | LiquidityZones                 |
| `TradeJS-Strategy-MaStrategy`                    | `@tradejs/strategy-ma-strategy`                     | MaStrategy                     |
| `TradeJS-Strategy-MarketFlushReversal`           | `@tradejs/strategy-market-flush-reversal`           | MarketFlushReversal            |
| `TradeJS-Strategy-RelativeRotation`              | `@tradejs/strategy-relative-rotation`               | RelativeRotation               |
| `TradeJS-Strategy-StructureZones`                | `@tradejs/strategy-structure-zones`                 | StructureZones                 |
| `TradeJS-Strategy-TrendFollow`                   | `@tradejs/strategy-trend-follow`                    | TrendFollow                    |
| `TradeJS-Strategy-TrendLine`                     | `@tradejs/strategy-trend-line`                      | TrendLine and ReverseTrendLine |
| `TradeJS-Strategy-TrendShift`                    | `@tradejs/strategy-trend-shift`                     | TrendShift                     |
| `TradeJS-Strategy-VolatilityCompressionBreakout` | `@tradejs/strategy-volatility-compression-breakout` | VolatilityCompressionBreakout  |
| `TradeJS-Strategy-VolumeDivergence`              | `@tradejs/strategy-volume-divergence`               | VolumeDivergence               |

TrendLine and ReverseTrendLine are the only combined strategy-repository
exception. They share family mechanics and must version those mechanics
atomically. Do not introduce a separate trendline family kit.

## Change routing

- Change a strategy core, adapter, config, figure, or family helper in its
  strategy repository.
- Change neutral strategy authoring helpers in `TradeJS-Strategy-Kit`.
- Change the default strategy list in `TradeJS-Base`.
- Change a personal strategy selection or runtime default in `TradeJS-Project`.
- Run personal backtests/replay/AI/research and keep local databases, artifacts,
  and immutable ignored research notes in `TradeJS-Project`.
- Change production topology, secrets, volumes, TLS, or server resource policy
  in `TradeJS-Deploy`.
- Change shared runtime semantics or public framework contracts in `TradeJS`.
