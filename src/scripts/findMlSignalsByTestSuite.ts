import args from 'args';
import Redis from 'ioredis';

args.example(
  'yarn ts-node ./src/scripts/findMlSignalsByTestSuite --testSuiteId 861d9d --pattern "ml:*:signals:*"',
  'Find ML signal keys by context.testSuiteId',
);

args.option(['p', 'pattern'], 'Redis key pattern', 'ml:signals:*');
args.option(['t', 'testSuiteId'], 'context.testSuiteId value', '861d9d');
args.option(['c', 'count'], 'SCAN COUNT', 500);

const flags = args.parse(process.argv);

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
});

const findKeys = async () => {
  const pattern = String(flags.pattern || 'ml:signals:*');
  const testSuiteId = String(flags.testSuiteId || '861d9d');
  const scanCount = Number(flags.count || 500);

  let cursor = '0';
  const matchedKeys: string[] = [];
  let scanned = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      scanCount,
    );
    cursor = nextCursor;

    for (const key of keys) {
      scanned++;
      const raw = await redis.call('JSON.GET', key, '$.context.testSuiteId');

      if (raw === `["${testSuiteId}"]`) {
        matchedKeys.push(key);
      }
    }
  } while (cursor !== '0');

  console.log(
    JSON.stringify(
      {
        pattern,
        testSuiteId,
        scanned,
        matched: matchedKeys.length,
        keys: matchedKeys,
      },
      null,
      2,
    ),
  );
};

findKeys()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    redis.disconnect();
  });
