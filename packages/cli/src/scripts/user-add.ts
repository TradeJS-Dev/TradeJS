import args from 'args';
import chalk from 'chalk';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getData, setData, redisKeys } from '@tradejs/infra';

args.example('yarn user-add -u myname -p 123456', 'Create or update user');
args.option(['u', 'user'], 'Username', '');
args.option(['p', 'password'], 'Password (plain text)', '');
args.option(['t', 'token'], 'Persistent token (optional)', '');

const flags = args.parse(process.argv);

const run = async () => {
  const userName = String(flags.user || '').trim();
  const password = String(flags.password || '');
  const requestedToken = String(flags.token || '').trim();

  if (!userName || !password) {
    console.error(chalk.red('Missing -U <user> or -P <password>'));
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = (await getData(redisKeys.user(userName), null)) as Record<
    string,
    unknown
  > | null;

  const existingToken =
    typeof existing === 'object' && existing
      ? ((existing as Record<string, unknown>).token as string | undefined)
      : undefined;
  const token =
    requestedToken ||
    existingToken ||
    (userName === 'root' ? crypto.randomBytes(24).toString('hex') : undefined);

  const next = {
    ...(existing ?? {}),
    passwordHash,
    userName,
    ...(token ? { token } : {}),
    updatedAt: new Date().toISOString(),
  };

  await setData(redisKeys.user(userName), next, {
    expire: 0,
  });

  console.log(chalk.green(`User ${userName} updated`));
  if (token) {
    console.log(chalk.gray(`token: ${token}`));
  }
  process.exit(0);
};

run();
