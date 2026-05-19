import args from 'args';
import chalk from 'chalk';
import bcrypt from 'bcryptjs';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';

args.example('yarn user-add -u myname -p 123456', 'Create or update user');
args.option(['u', 'user'], 'Username', '');
args.option(['p', 'password'], 'Password (plain text)', '');

const flags = args.parse(process.argv);

export const main = async () => {
  const userName = String(flags.user || '').trim();
  const password = String(flags.password || '');

  if (!userName || !password) {
    console.error(chalk.red('Missing -U <user> or -P <password>'));
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = (await getData(redisKeys.user(userName), null)) as Record<
    string,
    unknown
  > | null;

  const next = {
    ...(existing ?? {}),
    passwordHash,
    userName,
    updatedAt: new Date().toISOString(),
  };

  await setData(redisKeys.user(userName), next, {
    expire: 0,
  });

  console.log(chalk.green(`User ${userName} updated`));
  process.exit(0);
};
