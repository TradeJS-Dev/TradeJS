'use strict';

const PUBLISHABLE_PACKAGES = [
  '@tradejs/types',
  '@tradejs/infra',
  '@tradejs/core',
  '@tradejs/node',
  '@tradejs/indicators',
  '@tradejs/connectors',
  '@tradejs/cli',
  '@tradejs/app',
  'create-tradejs',
];

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const TRANSIENT_STATUS = (status) =>
  status === 404 ||
  status === 408 ||
  status === 425 ||
  status === 429 ||
  status >= 500;

const parseRetryAfterMs = (value, nowMs = Date.now()) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 0;
  if (/^\d+$/.test(normalized)) return Number(normalized) * 1000;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : 0;
};

const transientResult = (reason, response, nowMs) => ({
  ready: false,
  reason,
  retryAfterMs: parseRetryAfterMs(
    response?.headers?.get?.('retry-after'),
    nowMs,
  ),
});

const fetchWithTimeout = async ({
  fetchImpl,
  url,
  method = 'GET',
  headers,
  requestTimeoutMs,
}) => {
  const signal =
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(requestTimeoutMs)
      : undefined;
  return fetchImpl(url, { method, headers, signal });
};

const inspectPackageVersion = async ({
  packageName,
  version,
  expectedGitHead,
  registry = 'https://registry.npmjs.org',
  requireTarball = true,
  fetchImpl = fetch,
  requestTimeoutMs = 15_000,
  nowMs = Date.now(),
}) => {
  if (!PUBLISHABLE_PACKAGES.includes(packageName)) {
    throw new Error(`Unsupported publishable package: ${packageName}`);
  }
  if (!EXACT_VERSION.test(version)) {
    throw new Error(`Expected an exact npm version: ${version}`);
  }
  if (!FULL_GIT_SHA.test(expectedGitHead)) {
    throw new Error(`Expected a full lowercase git SHA: ${expectedGitHead}`);
  }

  const metadataUrl = `${registry.replace(/\/$/, '')}/${encodeURIComponent(
    packageName,
  )}/${encodeURIComponent(version)}`;
  const headers = {
    accept: 'application/json',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
  };

  let response;
  try {
    response = await fetchWithTimeout({
      fetchImpl,
      url: metadataUrl,
      headers,
      requestTimeoutMs,
    });
  } catch (error) {
    return transientResult(
      `metadata request failed: ${error instanceof Error ? error.message : String(error)}`,
      null,
      nowMs,
    );
  }

  if (!response.ok) {
    if (TRANSIENT_STATUS(response.status)) {
      return transientResult(
        `metadata HTTP ${response.status}`,
        response,
        nowMs,
      );
    }
    throw new Error(
      `${packageName}@${version}: registry metadata returned HTTP ${response.status}`,
    );
  }

  let manifest;
  try {
    manifest = await response.json();
  } catch (error) {
    return transientResult(
      `invalid metadata JSON: ${error instanceof Error ? error.message : String(error)}`,
      response,
      nowMs,
    );
  }

  if (manifest.version !== version) {
    throw new Error(
      `${packageName}@${version}: registry returned version ${String(manifest.version)}`,
    );
  }
  if (manifest.gitHead !== expectedGitHead) {
    throw new Error(
      `${packageName}@${version}: expected gitHead ${expectedGitHead}, got ${String(manifest.gitHead)}`,
    );
  }
  if (!manifest.dist?.integrity || !manifest.dist?.tarball) {
    throw new Error(
      `${packageName}@${version}: registry manifest has no integrity or tarball`,
    );
  }

  if (!requireTarball) return { ready: true, reason: 'metadata ready' };

  let tarballResponse;
  try {
    tarballResponse = await fetchWithTimeout({
      fetchImpl,
      url: manifest.dist.tarball,
      method: 'HEAD',
      headers: {
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
      requestTimeoutMs,
    });
  } catch (error) {
    return transientResult(
      `tarball request failed: ${error instanceof Error ? error.message : String(error)}`,
      null,
      nowMs,
    );
  }

  if (!tarballResponse.ok) {
    if (TRANSIENT_STATUS(tarballResponse.status)) {
      return transientResult(
        `tarball HTTP ${tarballResponse.status}`,
        tarballResponse,
        nowMs,
      );
    }
    throw new Error(
      `${packageName}@${version}: tarball returned HTTP ${tarballResponse.status}`,
    );
  }

  return { ready: true, reason: 'metadata and tarball ready' };
};

const retryDelayMs = ({ attempt, initialDelayMs, maxDelayMs, random }) => {
  const exponential = Math.min(
    maxDelayMs,
    initialDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.round(exponential * (0.8 + random() * 0.4));
};

const waitForPackageSet = async ({
  packageNames = PUBLISHABLE_PACKAGES,
  version,
  expectedGitHead,
  registry = 'https://registry.npmjs.org',
  requireTarball = true,
  timeoutMs = 10 * 60_000,
  requestTimeoutMs = 15_000,
  initialDelayMs = 5_000,
  maxDelayMs = 45_000,
  stableObservations = 2,
  fetchImpl = fetch,
  sleepImpl = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  nowImpl = Date.now,
  random = Math.random,
  onAttempt = () => {},
}) => {
  if (!Number.isInteger(stableObservations) || stableObservations < 1) {
    throw new Error('stableObservations must be a positive integer');
  }
  const startedAt = nowImpl();
  const deadline = startedAt + timeoutMs;
  let attempt = 0;
  let consecutiveReady = 0;
  let lastResults = [];

  while (nowImpl() <= deadline) {
    attempt += 1;
    const nowMs = nowImpl();
    lastResults = await Promise.all(
      packageNames.map(async (packageName) => ({
        packageName,
        ...(await inspectPackageVersion({
          packageName,
          version,
          expectedGitHead,
          registry,
          requireTarball,
          fetchImpl,
          requestTimeoutMs,
          nowMs,
        })),
      })),
    );
    const allReady = lastResults.every(({ ready }) => ready);
    consecutiveReady = allReady ? consecutiveReady + 1 : 0;
    onAttempt({
      attempt,
      consecutiveReady,
      stableObservations,
      results: lastResults,
      elapsedMs: nowImpl() - startedAt,
    });
    if (consecutiveReady >= stableObservations) {
      return {
        attempt,
        elapsedMs: nowImpl() - startedAt,
        results: lastResults,
      };
    }

    const remainingMs = deadline - nowImpl();
    if (remainingMs <= 0) break;
    const requestedRetryAfterMs = Math.max(
      0,
      ...lastResults.map(({ retryAfterMs = 0 }) => retryAfterMs),
    );
    const delayMs = Math.min(
      remainingMs,
      Math.max(
        requestedRetryAfterMs,
        retryDelayMs({ attempt, initialDelayMs, maxDelayMs, random }),
      ),
    );
    await sleepImpl(delayMs);
  }

  const unavailable = lastResults
    .filter(({ ready }) => !ready)
    .map(({ packageName, reason }) => `${packageName}: ${reason}`)
    .join('; ');
  throw new Error(
    `npm registry did not converge for ${version} within ${timeoutMs}ms${
      unavailable ? ` (${unavailable})` : ''
    }`,
  );
};

module.exports = {
  PUBLISHABLE_PACKAGES,
  inspectPackageVersion,
  parseRetryAfterMs,
  retryDelayMs,
  waitForPackageSet,
};
