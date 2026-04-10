import args from 'args';
import chalk from 'chalk';
import { cleanRedis } from '@tradejs/node/cli';
import { getKeys, redisKeys } from '@tradejs/infra/redis';

args.option(['U', 'user'], 'Clean tests for user', '');
args.option(['C', 'cache'], 'Clean only cache keys', false);

const flags = args.parse(process.argv);

const extractUsers = (keys: string[]): string[] => {
  const users = new Set<string>();

  for (const key of keys) {
    const parts = key.split(':');
    if (parts.length < 2) {
      continue;
    }
    if (parts[0] !== 'users' || parts[1] !== 'index') {
      continue;
    }
    const userName = (parts[2] ?? '').trim();
    if (userName) {
      users.add(userName);
    }
  }

  return Array.from(users).sort();
};

const getUsersToClean = async (): Promise<string[]> => {
  const userName = String(flags.user || '').trim();
  if (userName) {
    return [userName];
  }

  const keys = await getKeys(redisKeys.users());
  return extractUsers(keys);
};

const cleanUserTests = async (userName: string) => {
  const testsPrefix = `users:${userName}:tests:`;
  const testsCachePrefix = `users:${userName}:cache:tests:`;

  if (flags.cache) {
    console.log(chalk.yellow(`clean user cache: ${userName}`));
    await cleanRedis(testsCachePrefix);
    return;
  }

  console.log(chalk.yellow(`clean user tests: ${userName}`));
  await cleanRedis(testsPrefix);
  await cleanRedis(testsCachePrefix);
};

const run = async () => {
  const users = await getUsersToClean();

  if (users.length === 0) {
    console.log(chalk.yellow('No users found to clean tests.'));
    process.exit();
  }

  for await (const userName of users) {
    await cleanUserTests(userName);
  }

  process.exit();
};

run();
