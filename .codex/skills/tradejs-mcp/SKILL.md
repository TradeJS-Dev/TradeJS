---
name: tradejs-mcp
description: Use an authenticated TradeJS MCP server from Codex or Claude Code to inspect coins, charts, runtime strategies, signals, orders, cached backtests, and verified runtime feedback/parity. Use for remote TradeJS inspection that previously required SSH; never authorize OAuth or trade live on the user's behalf.
---

# TradeJS through MCP

1. Use the configured TradeJS server. If missing, give the human the connection
   commands from the knowledge base at `/guides/mcp`. Never start OAuth consent,
   device authorization, re-login or permission elevation yourself.
2. Call `tradejs_info`, then `runtime_get_status` for runtime work. Verify the
   host URL, authenticated user, available scopes, account/deployment and
   observed times. A local server is not production evidence.
3. Read `market_list_symbols`, `market_get_snapshot`, `chart_get_context` for
   coins/charts. Preserve provider, universe, symbol, interval and period.
   Cached history is the default; report incomplete coverage. Strategy figures
   come from the recorded signal, not inferred chart annotations.
4. Use `runtime_list_strategies`, `runtime_list_signals`,
   `runtime_list_evaluations`, `runtime_list_orders` and
   `runtime_get_evaluation_summary`. Follow cursors to `0`, including empty
   pages. Runtime cursors expire after ten minutes and are bound to filters.
   `runtime_get_signal` takes signalId, deploymentId, timestamp and strategy
   from the list. Explain the saved decision, gate, order status and evidence.
   Do not turn missing retained records into proof that nothing happened.
5. Prefer existing verified `diagnostics_list_reports` / `diagnostics_get_report`
   before new jobs. For full artifacts call `artifact_get`, concatenate decoded
   base64 chunks in offset order, verify byte count and SHA-256, then use the
   relevant local analysis skill. Debug counters never replace sealed evidence.
6. On an explicit user request, use `backtest_start` or `diagnostics_start`,
   retain the job id and idempotency key, and poll `job_get`. Backtests snapshot
   the named grid; limits are 90 days, 20 symbols, eight combinations, cached
   history, one worker. Evidence capture is limited to seven days. Feedback
   replay requires a verified evidence id for that deployment and an isolated
   replay worker. Disconnects do not cancel work; never automatically retry a
   failed job. Use `job_cancel` only when requested.
7. Include source host, time bounds, revisions, coverage, checksums and missing
   evidence in the result. Use local CLI for offline analysis or work exceeding
   the bounded MCP job contract. SSH needs a separate explicit operational
   request; do not broaden access to compensate for a missing tool or scope.

MCP has no tools for live order placement/cancellation, runtime config writes,
release publication, deployment or notifications. OAuth scopes do not grant
permission to perform those actions. Skills and AGENTS.md do not change that.
