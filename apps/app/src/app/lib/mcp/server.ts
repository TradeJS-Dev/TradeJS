import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpStorage } from '@tradejs/infra/redis';
import {
  cancelMcpJob,
  enqueueMcpJob,
  mcpId,
  publicMcpJob,
  readMcpBacktestPage,
  readMcpBacktestResult,
  readMcpChart,
  readMcpDeployments,
  readMcpEvaluationStats,
  readMcpJob,
  readMcpMarket,
  readMcpRuntimePage,
  readMcpSignal,
  readMcpStrategies,
  redactMcpData,
  requireMcpDeployment,
} from '@tradejs/node/mcp';
import type { McpPrincipal, McpScope } from '@tradejs/types';
import {
  listMcpArtifacts,
  readMcpArtifactChunk,
  readMcpDiagnosticReport,
  resolveMcpArtifact,
} from './artifacts';
import { mcpResource } from './oauth';

const identifier = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);
const provider = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9_-]+$/)
  .default('bybit');
const universe = z.enum(['crypto', 'tradfi']).default('crypto');
const symbol = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9._-]+$/);
const interval = z
  .enum([
    '1',
    '3',
    '5',
    '15',
    '30',
    '60',
    '120',
    '240',
    '360',
    '720',
    'D',
    'W',
    'M',
  ])
  .default('15');
const cursor = z
  .string()
  .regex(/^\d{1,30}$/)
  .default('0');
const timestamp = z.number().int().positive();
const artifactId = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const runtimePage = {
  deploymentId: identifier,
  cursor: z
    .string()
    .regex(/^(0|[a-f0-9]{64})$/)
    .default('0'),
  startTime: timestamp,
  endTime: timestamp,
  strategy: identifier.optional(),
  symbol: symbol.optional(),
};

export const createTradejsMcpServer = (principal: McpPrincipal) => {
  const server = new McpServer(
    { name: 'tradejs', version: '1.0.0' },
    {
      instructions:
        'TradeJS tools read this host only. Check tradejs_info and runtime_get_status before interpreting production data. Missing records are not proof of no activity. Use explicit deployments and periods. Run jobs only on user request; poll job_get. Historical jobs use cached data. No tool places live orders, changes strategy config, deploys, or sends notifications. OAuth is performed by the human user. Never request secrets. Complete artifact downloads must match the advertised SHA-256.',
    },
  );

  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    scopes: McpScope[],
    shape: S,
    handler: (args: z.output<z.ZodObject<S>>) => Promise<unknown>,
    mutates = false,
  ) => {
    if (
      scopes.length &&
      !scopes.some((scope) => principal.scopes.includes(scope))
    )
      return;
    const schema = z.object(shape).strict();
    server.registerTool<z.ZodRawShape, typeof schema>(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: !mutates,
          destructiveHint: name === 'job_cancel',
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        const auditId = `audit:${mcpId(principal.userName)}:${randomUUID()}`;
        try {
          if (
            !scopes.some((scope) => principal.scopes.includes(scope)) &&
            scopes.length
          )
            throw new Error('Insufficient scope');
          if (mutates)
            await mcpStorage.put(
              auditId,
              {
                tool: name,
                userName: principal.userName,
                clientId: principal.clientId,
                argumentSha256: mcpId(JSON.stringify(args)),
                createdAt: Date.now(),
                status: 'requested',
              },
              30 * 86400,
            );
          const result = redactMcpData(
            await handler(args as z.output<z.ZodObject<S>>),
          );
          const text = JSON.stringify(result);
          if (Buffer.byteLength(text) > 128 * 1024)
            throw new Error(
              'Response too large. Narrow the filters or use artifact_get for full reports.',
            );
          if (mutates)
            await mcpStorage.put(
              auditId,
              {
                tool: name,
                userName: principal.userName,
                clientId: principal.clientId,
                createdAt: Date.now(),
                status: 'accepted',
              },
              30 * 86400,
            );
          return {
            content: [{ type: 'text' as const, text }],
            structuredContent: { data: result },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          // Filesystem, connector and database errors may contain secrets or paths.
          const safe =
            /^(?:Select |Provide |MCP |Backtest config not found|Deployment unavailable|Signal not found|Result not found|Job not found|Invalid (?:job|artifact|result|storage) |Artifact (?:not found|changed)|Only the submitting|Idempotency |Hourly job|Job changed|Insufficient scope|Response too large|Unknown market provider|Unsupported diagnostic)/.test(
              message,
            )
              ? message
              : 'TradeJS operation failed. Check server diagnostics.';
          return {
            isError: true,
            content: [{ type: 'text' as const, text: safe }],
          };
        }
      },
    );
  };

  tool(
    'tradejs_info',
    'Identify this TradeJS server, granted permissions and worker availability. Check this before using runtime data.',
    [],
    {},
    async () => ({
      resource: mcpResource(),
      userName: principal.userName,
      scopes: principal.scopes,
      observedAt: Date.now(),
      worker: await mcpStorage.get('worker:heartbeat'),
      liveTradingTools: false,
      artifactEncoding: 'base64',
    }),
  );
  tool(
    'market_list_symbols',
    'List market tickers with pagination. Provider reads may contact the market data service.',
    ['market:read'],
    {
      provider,
      universe,
      offset: z.number().int().min(0).max(100000).default(0),
      limit: z.number().int().min(1).max(100).default(50),
    },
    async (args) =>
      readMcpMarket(
        principal.userName,
        args.provider,
        args.universe,
        args.offset,
        args.limit,
      ),
  );
  tool(
    'market_get_snapshot',
    'Read the current market ticker for one symbol, with observation time.',
    ['market:read'],
    { provider, universe, symbol },
    async (args) =>
      readMcpMarket(
        principal.userName,
        args.provider,
        args.universe,
        0,
        1,
        args.symbol,
      ),
  );
  tool(
    'chart_get_context',
    'Get up to 300 closed candles and indicator series. Cached history is the default. Explicit cacheOnly=false permits a market history fetch. Saved strategy figures are available through runtime_get_signal.',
    ['market:read'],
    {
      provider,
      universe,
      symbol,
      interval,
      endTime: timestamp.optional(),
      bars: z.number().int().min(10).max(300).default(100),
      cacheOnly: z.boolean().default(true),
      indicatorNames: z.array(identifier).max(12).optional(),
    },
    async (args) =>
      readMcpChart(principal.userName, {
        ...args,
        endTime: args.endTime ?? Date.now(),
      }),
  );
  tool(
    'runtime_get_status',
    'Read accessible Git-owned deployments and observed runtime heartbeats. Missing heartbeat is unknown health, not proof that runtime never ran.',
    ['runtime:read'],
    {},
    async () => readMcpDeployments(principal.userName),
  );
  tool(
    'runtime_list_strategies',
    'Read effective strategies, configs and immutable revisions for a deployment bound to this user account.',
    ['runtime:read'],
    { deploymentId: identifier },
    async (args) => readMcpStrategies(principal.userName, args.deploymentId),
  );
  for (const kind of ['signals', 'evaluations', 'orders'] as const) {
    tool(
      `runtime_list_${kind}`,
      `Read a bounded storage page of ${kind}. Window is half-open [startTime,endTime), at most 7 days. Continue even after an empty page until cursor=0.`,
      ['runtime:read'],
      runtimePage,
      async (args) => {
        if (
          args.endTime <= args.startTime ||
          args.endTime - args.startTime > 7 * 86400000
        )
          throw new Error('Select a window of at most 7 days');
        return readMcpRuntimePage(principal.userName, kind, args);
      },
    );
  }
  tool(
    'runtime_get_signal',
    'Read one owned signal, including recorded indicators, figures, gate decisions and execution status.',
    ['runtime:read'],
    {
      signalId: identifier,
      deploymentId: identifier,
      timestamp,
      strategy: identifier,
    },
    async (args) =>
      readMcpSignal(
        principal.userName,
        args.signalId,
        args.deploymentId,
        args.timestamp,
        args.strategy,
      ),
  );
  tool(
    'runtime_get_evaluation_summary',
    'Read aggregate evaluation/skip counters. These are debug telemetry and cannot substitute for composition-bound runtime evidence.',
    ['runtime:read'],
    { deploymentId: identifier, cursor },
    async (args) =>
      readMcpEvaluationStats(
        principal.userName,
        args.deploymentId,
        args.cursor,
      ),
  );
  for (const kind of ['configs', 'results'] as const)
    tool(
      `backtest_list_${kind}`,
      `Read a page of saved backtest ${kind}. Continue until cursor=0.`,
      ['backtests:read'],
      { cursor },
      async (args) =>
        readMcpBacktestPage(principal.userName, kind, args.cursor),
    );
  tool(
    'backtest_get_result',
    'Read a saved backtest result by the exact id returned by backtest_list_results.',
    ['backtests:read'],
    {
      id: identifier,
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async (args) =>
      readMcpBacktestResult(
        principal.userName,
        args.id,
        args.offset,
        args.limit,
      ),
  );
  tool(
    'backtest_start',
    'Queue a cached backtest on explicit user request: at most 90 days, 20 symbols, 8 config combinations, one worker, no paid AI calls. Returns immediately. Reuse idempotencyKey only for the identical request.',
    ['backtests:run'],
    {
      configId: identifier,
      provider,
      interval,
      symbols: z.array(symbol).min(1).max(20),
      startTime: timestamp,
      endTime: timestamp,
      idempotencyKey,
    },
    async ({ idempotencyKey: key, ...args }) =>
      publicMcpJob(await enqueueMcpJob(principal, 'backtest', args, key)),
    true,
  );
  tool(
    'job_get',
    'Read the state of an owned background job. Disconnecting the client does not pause it. Failed jobs are never automatically rerun.',
    ['backtests:read', 'diagnostics:read', 'backtests:run', 'diagnostics:run'],
    { jobId: artifactId },
    async (args) => {
      const job = await readMcpJob(principal.userName, args.jobId);
      if (
        !principal.scopes.some(
          (scope) =>
            scope ===
              (job.kind === 'backtest'
                ? 'backtests:read'
                : 'diagnostics:read') ||
            scope ===
              (job.kind === 'backtest' ? 'backtests:run' : 'diagnostics:run'),
        )
      )
        throw new Error('Insufficient scope');
      return publicMcpJob(job);
    },
  );
  tool(
    'job_cancel',
    'Cancel a queued/running job submitted by this OAuth client. Does not delete completed results.',
    ['backtests:run', 'diagnostics:run'],
    { jobId: artifactId },
    async (args) => {
      const job = await readMcpJob(principal.userName, args.jobId);
      if (
        !principal.scopes.includes(
          job.kind === 'backtest' ? 'backtests:run' : 'diagnostics:run',
        )
      )
        throw new Error('Insufficient scope');
      return publicMcpJob(await cancelMcpJob(principal, args.jobId));
    },
    true,
  );
  tool(
    'diagnostics_list_reports',
    'List checksum-verified runtime evidence and feedback/parity bundles present on this host and owned by this user. Inaccessible/unverified bundles are excluded.',
    ['diagnostics:read'],
    {
      deploymentId: z.string().optional(),
      kind: z.enum(['runtime-evidence', 'runtime-feedback-replay']).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async (args) => listMcpArtifacts(principal.userName, args),
  );
  tool(
    'diagnostics_get_report',
    'Read a verified diagnostic report or its manifest/summary. Use artifact_get for the full original payload.',
    ['diagnostics:read'],
    { artifactId },
    async (args) =>
      readMcpDiagnosticReport(principal.userName, args.artifactId),
  );
  tool(
    'artifact_get',
    'Read an owned verified artifact in base64 chunks. Concatenate decoded bytes, verify total size and SHA-256 before local analysis. No filesystem path is accepted.',
    ['diagnostics:read'],
    {
      artifactId,
      offset: z.number().int().min(0).default(0),
      length: z.number().int().min(1).max(48000).default(48000),
    },
    async (args) =>
      readMcpArtifactChunk(
        principal.userName,
        args.artifactId,
        args.offset,
        args.length,
      ),
  );
  tool(
    'diagnostics_start',
    'Queue runtime-evidence capture or isolated runtime-feedback replay/parity on explicit user request. Replay requires a verified evidence artifact and exact recorded package/image lineage. No notifications or live orders.',
    ['diagnostics:run'],
    {
      kind: z.enum(['runtime-evidence', 'runtime-feedback-replay']),
      deploymentId: identifier,
      startTime: timestamp.optional(),
      endTime: timestamp.optional(),
      artifactId: artifactId.optional(),
      idempotencyKey,
    },
    async ({ idempotencyKey: key, kind, ...args }) => {
      await requireMcpDeployment(principal.userName, args.deploymentId);
      if (kind === 'runtime-evidence')
        return publicMcpJob(await enqueueMcpJob(principal, kind, args, key));
      if (!args.artifactId) throw new Error('Select verified runtime evidence');
      const artifact = await resolveMcpArtifact(
        principal.userName,
        args.artifactId,
      );
      if (
        artifact.kind !== 'runtime-evidence' ||
        artifact.deploymentId !== args.deploymentId
      )
        throw new Error('Select verified runtime evidence for this deployment');
      return publicMcpJob(
        await enqueueMcpJob(
          principal,
          kind,
          { ...args, verifiedEvidencePath: artifact.payloadPath },
          key,
        ),
      );
    },
    true,
  );
  return server;
};
