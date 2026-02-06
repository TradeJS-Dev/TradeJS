import args from 'args';
import chalk from 'chalk';
import { cleanRedis } from '@utils/cli';
import { getKeys, redisKeys } from '@utils/redis';

args.option(['U', 'user'], 'Clean tests for user', '');

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
  const cachePrefix = `users:${userName}:cache:tests:`;

  console.log(chalk.yellow(`clean user tests: ${userName}`));

  await cleanRedis(testsPrefix);
  await cleanRedis(cachePrefix);
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
