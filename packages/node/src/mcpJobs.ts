import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDataStrict, mcpStorage, redisKeys } from '@tradejs/infra/redis';
import type { McpJob, McpPrincipal } from '@tradejs/types';

export const MCP_JOB_TTL = 7 * 86400;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const mcpJobStorageId = (userName: string, id: string) =>
  `jobs:${hash(userName)}:${id}`;
export const mcpJobDirectory = (job: Pick<McpJob, 'userName' | 'id'>) =>
  path.join(
    String(process.env.PROJECT_CWD || process.cwd()),
    'data/mcp',
    hash(job.userName),
    job.id,
  );
export const mcpPackageManifestHash = async () =>
  hash(
    await readFile(
      path.join(
        String(process.env.PROJECT_CWD || process.cwd()),
        'runtime-package-manifest.json',
      ),
      'utf8',
    ),
  );

const assertWindow = (startTime: number, endTime: number, maxDays: number) => {
  if (
    !Number.isSafeInteger(startTime) ||
    !Number.isSafeInteger(endTime) ||
    startTime <= 0 ||
    endTime <= startTime ||
    endTime > Date.now() ||
    endTime - startTime > maxDays * 86400000
  )
    throw new Error(`Select a past window of at most ${maxDays} days`);
};

export const enqueueMcpJob = async (
  principal: McpPrincipal,
  kind: McpJob['kind'],
  request: Record<string, unknown>,
  idempotencyKey: string,
) => {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))
    throw new Error(
      'Provide an idempotencyKey of 8–100 letters, digits, underscores or hyphens',
    );
  const id = hash(
    `${principal.userName}:${principal.clientId}:${idempotencyKey}`,
  );
  const storageId = mcpJobStorageId(principal.userName, id);
  const existing = await mcpStorage.get<McpJob>(storageId);
  if (existing) {
    if (
      existing.kind !== kind ||
      existing.request.requestFingerprint !== hash(JSON.stringify(request))
    )
      throw new Error('Idempotency key was used for another request');
    return existing;
  }
  const worker = await mcpStorage.get<{ replayAvailable?: boolean }>(
    'worker:heartbeat',
  );
  if (!worker) throw new Error('MCP worker is unavailable; no job was queued');
  if (
    !(await mcpStorage.rateLimit(`jobs:${hash(principal.userName)}`, 10, 3600))
  )
    throw new Error('Hourly job limit reached');
  const job: McpJob = {
    id,
    userName: principal.userName,
    clientId: principal.clientId,
    kind,
    status: 'queued',
    request: { ...request, requestFingerprint: hash(JSON.stringify(request)) },
    args: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    logs: [],
    outputId: id,
    packageManifestSha256: await mcpPackageManifestHash(),
  };
  const outputDir = mcpJobDirectory(job);
  if (kind === 'backtest') {
    assertWindow(Number(request.startTime), Number(request.endTime), 90);
    const configId = String(request.configId || '');
    if (!/^[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9_-]+$/.test(configId))
      throw new Error('Select a named Strategy:config');
    const grid = await getDataStrict(
      redisKeys.backtestConfig(principal.userName, configId),
    );
    if (!grid || typeof grid !== 'object' || Array.isArray(grid))
      throw new Error('Backtest config not found');
    const cells = Object.values(grid);
    if (
      !cells.length ||
      !cells.every((cell) => Array.isArray(cell) && cell.length > 0) ||
      cells.reduce((n, cell) => n * (cell as unknown[]).length, 1) > 8
    )
      throw new Error('MCP backtests allow at most eight config combinations');
    const symbols = request.symbols;
    if (
      !Array.isArray(symbols) ||
      !symbols.length ||
      symbols.length > 20 ||
      !symbols.every(
        (symbol) =>
          typeof symbol === 'string' && /^[A-Z0-9._-]{1,40}$/.test(symbol),
      )
    )
      throw new Error('Select 1–20 symbols');
    const frozenConfigId = `${configId.split(':')[0]}:mcp_${id}`;
    job.request = {
      ...job.request,
      resolvedConfig: grid,
      configSha256: hash(JSON.stringify(grid)),
      frozenConfigId,
    };
    job.args = [
      'backtest',
      '--user',
      principal.userName,
      '--config',
      frozenConfigId,
      '--connector',
      String(request.provider),
      '--timeframe',
      String(request.interval),
      '--startTime',
      String(request.startTime),
      '--endTime',
      String(request.endTime),
      '--tickers',
      symbols.join(','),
      '--parallel',
      '1',
      '--cacheOnly',
      '--fast',
      '--persistResults',
    ];
  } else if (kind === 'runtime-evidence') {
    assertWindow(Number(request.startTime), Number(request.endTime), 7);
    job.args = [
      'runtime-evidence',
      '--user',
      principal.userName,
      '--deployment',
      String(request.deploymentId),
      '--startTime',
      String(request.startTime),
      '--endTime',
      String(request.endTime),
      '--publishDir',
      outputDir,
    ];
  } else if (kind === 'runtime-feedback-replay') {
    if (!worker.replayAvailable)
      throw new Error('MCP replay worker requires an isolated Redis host');
    // Evidence paths are resolved by the verified catalog adapter, never by clients.
    if (typeof request.verifiedEvidencePath !== 'string')
      throw new Error('Select verified runtime evidence');
    job.args = [
      'runtime-feedback-replay',
      '--runtimeEvidence',
      request.verifiedEvidencePath,
      '--outDir',
      outputDir,
      '--runId',
      id,
    ];
  } else {
    throw new Error(
      'Unsupported diagnostic kind; use verified runtime feedback for deployment-bound parity',
    );
  }
  if (!(await mcpStorage.put(storageId, job, MCP_JOB_TTL, true))) {
    const winner = await readMcpJob(principal.userName, id);
    if (
      winner.kind !== kind ||
      winner.request.requestFingerprint !== job.request.requestFingerprint
    )
      throw new Error('Idempotency key was used for another request');
    return winner;
  }
  return job;
};

export const readMcpJob = async (userName: string, id: string) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid job id');
  const job = await mcpStorage.get<McpJob>(mcpJobStorageId(userName, id));
  if (!job || job.userName !== userName) throw new Error('Job not found');
  return job;
};

export const readAuthorizedMcpJob = async (
  principal: McpPrincipal,
  id: string,
) => {
  const job = await readMcpJob(principal.userName, id);
  const prefix = job.kind === 'backtest' ? 'backtests' : 'diagnostics';
  if (
    !principal.scopes.some(
      (scope) => scope === `${prefix}:read` || scope === `${prefix}:run`,
    )
  )
    throw new Error('Insufficient scope');
  return job;
};

export const redactMcpJobLog = (line: string) =>
  line
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/((?:authorization|cookie)\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(
      /((?:[\w.-]*(?:secret|password|token|api[_-]?key|private[_-]?key|authorization|cookie|credential)[\w.-]*)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi,
      '$1[redacted]',
    )
    .slice(0, 1000);

/** Offsets refer to the retained worker tail, which may shift while running. */
export const readMcpJobLogs = async (
  principal: McpPrincipal,
  id: string,
  offset = 0,
  limit = 50,
) => {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('Select a non-negative log offset and a limit of 1–100');
  const job = await readAuthorizedMcpJob(principal, id);
  const lines: string[] = [];
  let bytes = 0;
  for (const line of job.logs.slice(offset, offset + limit)) {
    const redacted = redactMcpJobLog(line);
    const size = Buffer.byteLength(JSON.stringify(redacted)) + 1;
    if (bytes + size > 48000) break;
    lines.push(redacted);
    bytes += size;
  }
  const next = offset + lines.length;
  return {
    jobId: job.id,
    status: job.status,
    updatedAt: job.updatedAt,
    offset,
    nextOffset: next < job.logs.length ? next : null,
    retainedLines: job.logs.length,
    retention: 'worker_tail',
    lines,
  };
};

export const cancelMcpJob = async (principal: McpPrincipal, id: string) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const job = await readMcpJob(principal.userName, id);
    if (job.clientId !== principal.clientId)
      throw new Error('Only the submitting client can cancel this job');
    if (!['queued', 'running'].includes(job.status)) return job;
    const next: McpJob = {
      ...job,
      cancelRequested: true,
      updatedAt: Date.now(),
      ...(job.status === 'queued'
        ? { status: 'cancelled' as const, finishedAt: Date.now() }
        : {}),
    };
    if (
      await mcpStorage.compare(
        mcpJobStorageId(job.userName, job.id),
        job,
        next,
        MCP_JOB_TTL,
      )
    )
      return next;
  }
  throw new Error('Job changed; retry cancellation');
};

export const publicMcpJob = (job: McpJob) => {
  const { args: _args, logs: _logs, request: _request, ...view } = job;
  return {
    ...view,
    request: Object.fromEntries(
      Object.entries(job.request).filter(
        ([key]) => !['verifiedEvidencePath', 'resolvedConfig'].includes(key),
      ),
    ),
    logLines: job.logs.length,
  };
};
