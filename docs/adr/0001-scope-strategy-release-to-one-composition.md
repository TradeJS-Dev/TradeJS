# Scope Strategy Release to one composition

TradeJS will use one repository-local `strategy-release` skill with `release` and `diagnose-live` modes to improve and validate one frozen core-plus-AI-gate Strategy Composition. The skill may change and test local strategy and gate code, but it must not change runtime config, `MAX_LOSS_VALUE`, order placement, or production processes without separate approval; portfolio allocation and daily-loss enforcement remain outside this contour so it can answer the narrower question of whether one strategy is suitable for the current market.

Research is bounded to three causal hypothesis families with five variants each, one isolated-long finalist, and one AI-gate tuning round. Historical backtests always use `--cacheOnly`, and the longest test uses only the candle window already available for the frozen universe.
