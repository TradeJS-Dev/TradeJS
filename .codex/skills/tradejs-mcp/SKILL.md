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
   pages. Runtime cursors are shared across server processes, expire after 24
   hours and are bound to the same window and filters. Retry the identical
   request after a transport failure. On `CURSOR_EXPIRED`, restart that window
   at cursor `0` and deduplicate record identities; storage order is not
   chronological and scans are not immutable snapshots.
   `runtime_get_signal` takes signalId, deploymentId, timestamp and strategy
   from the list. Explain the saved decision, gate, order status and evidence.
   Do not turn missing retained records into proof that nothing happened.
   For deployed package/image verification, use `runtime_get_verification`
   with the deployment id. Check the bound account/composition, Project SHA,
   actual image digest, package manifest, `verification.ok`, health, `fresh`,
   collection status and `deploymentVerifiedAt`. A heartbeat does not replace
   this report; unavailable or stale verification stays incomplete.
5. Prefer existing verified `diagnostics_list_reports` / `diagnostics_get_report`
   before new jobs. Paginate the catalog with `offset`, `limit` and
   `nextOffset` until null. Preserve `scanTruncated` and excluded-bundle counts
   as coverage limitations. For full artifacts call `artifact_get`, concatenate decoded
   base64 chunks in offset order, verify byte count and SHA-256, then use the
   relevant local analysis skill. `diagnostics_get_report.files` lists the
   available payload, manifest, completion marker and optional replay log;
   each file has its own size and SHA-256. Select it through `artifact_get.file`,
   never a filesystem path. Debug counters never replace sealed evidence.
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
