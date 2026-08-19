const {
  inspectPackageVersion,
  parseRetryAfterMs,
  retryDelayMs,
  waitForPackageSet,
}: {
  inspectPackageVersion: (options: Record<string, unknown>) => Promise<{
    ready: boolean;
    reason: string;
    retryAfterMs?: number;
  }>;
  parseRetryAfterMs: (value: unknown, nowMs?: number) => number;
  retryDelayMs: (options: {
    attempt: number;
    initialDelayMs: number;
    maxDelayMs: number;
    random: () => number;
  }) => number;
  waitForPackageSet: (options: Record<string, unknown>) => Promise<{
    attempt: number;
  }>;
} = require('../npmRegistryConsistency.cjs');

const sha = 'a'.repeat(40);
const manifest = (version = '3.1.11') => ({
  version,
  gitHead: sha,
  dist: {
    integrity: 'sha512-example',
    tarball: 'https://registry.npmjs.org/example/-/example-3.1.11.tgz',
  },
});
const response = (
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
});

describe('npm registry consistency barrier', () => {
  it('treats propagation misses and rate limits as retryable', async () => {
    await expect(
      inspectPackageVersion({
        packageName: 'create-tradejs',
        version: '3.1.11',
        expectedGitHead: sha,
        nowMs: 1_000,
        fetchImpl: jest.fn(async () =>
          response(429, {}, { 'retry-after': '3' }),
        ),
      }),
    ).resolves.toEqual({
      ready: false,
      reason: 'metadata HTTP 429',
      retryAfterMs: 3_000,
    });
  });

  it('fails immediately when an immutable version has different provenance', async () => {
    await expect(
      inspectPackageVersion({
        packageName: '@tradejs/types',
        version: '3.1.11',
        expectedGitHead: sha,
        fetchImpl: jest.fn(async () =>
          response(200, { ...manifest(), gitHead: 'b'.repeat(40) }),
        ),
      }),
    ).rejects.toThrow('expected gitHead');
  });

  it('waits for metadata and tarballs to be ready twice consecutively', async () => {
    let now = 0;
    let metadataReads = 0;
    const fetchImpl = jest.fn(
      async (_url: string, options: { method?: string }) => {
        if (options.method === 'HEAD') return response(200);
        metadataReads += 1;
        return metadataReads === 1 ? response(404) : response(200, manifest());
      },
    );

    const result = await waitForPackageSet({
      packageNames: ['@tradejs/types'],
      version: '3.1.11',
      expectedGitHead: sha,
      timeoutMs: 10_000,
      initialDelayMs: 100,
      maxDelayMs: 500,
      stableObservations: 2,
      fetchImpl,
      nowImpl: () => now,
      sleepImpl: async (delay: number) => {
        now += delay;
      },
      random: () => 0.5,
    });

    expect(result.attempt).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('honors Retry-After and caps exponential backoff', () => {
    expect(parseRetryAfterMs('4', 0)).toBe(4_000);
    expect(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 1_000)).toBe(
      4_000,
    );
    expect(
      retryDelayMs({
        attempt: 10,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        random: () => 0.5,
      }),
    ).toBe(8_000);
  });
});
