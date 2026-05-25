import args from 'args';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ProgressBar from 'progress';
import {
  cleanFiles,
  cleanIndicatorCacheObsoleteVersions,
  cleanRedis,
} from '@tradejs/node/cli';
import {
  getBacktestCacheArtifactsDirForUser,
  getPersistedBacktestArtifactsDirForUser,
} from '@tradejs/infra/backtestArtifacts';
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
  const projectRoot = process.env.PROJECT_CWD || process.cwd();
  const persistedArtifactsDir = path.relative(
    projectRoot,
    getPersistedBacktestArtifactsDirForUser(userName, projectRoot),
  );
  const cacheArtifactsDir = path.relative(
    projectRoot,
    getBacktestCacheArtifactsDirForUser(userName, projectRoot),
  );

  if (flags.cache) {
    console.log(chalk.yellow(`clean user cache: ${userName}`));
    await cleanRedis(testsCachePrefix);
    await cleanFiles(cacheArtifactsDir);
    return;
  }

  console.log(chalk.yellow(`clean user tests: ${userName}`));
  await cleanRedis(testsPrefix);
  await cleanRedis(testsCachePrefix);
  await cleanFiles(persistedArtifactsDir);
  await cleanFiles(cacheArtifactsDir);
  await fs.rm(path.join(projectRoot, persistedArtifactsDir), {
    recursive: true,
    force: true,
  });
  await fs.rm(path.join(projectRoot, cacheArtifactsDir), {
    recursive: true,
    force: true,
  });
};

const cleanObsoleteIndicatorCacheVersions = async () => {
  console.log(chalk.yellow('clean indicator cache obsolete versions'));

  const bars = new Map<string, ProgressBar>();
  const previousDeletedRows = new Map<string, number>();
  const batchSize = Math.max(
    1,
    Number.parseInt(
      String(process.env.INDICATOR_CACHE_CLEAN_BATCH_SIZE ?? '50000'),
      10,
    ) || 50_000,
  );

  const result = await cleanIndicatorCacheObsoleteVersions({
    batchSize,
    onProgress: (progress) => {
      if (progress.phase === 'index') {
        const key = 'indexes';
        let bar = bars.get(key);
        if (!bar) {
          console.log(
            chalk.gray(
              'preparing indicator cache cleanup indexes (first run can take a while)...',
            ),
          );
          bar = new ProgressBar(
            'indexes :current/:total [:bar][:percent] :eta(s)',
            {
              total: Math.max(1, progress.totalRows),
              width: 24,
            },
          );
          bars.set(key, bar);
          previousDeletedRows.set(key, 0);
        }

        const previousDeleted = previousDeletedRows.get(key) ?? 0;
        const nextDeleted = Math.min(progress.deletedRows, progress.totalRows);
        const delta = Math.max(0, nextDeleted - previousDeleted);
        if (delta > 0) {
          bar.tick(delta);
          previousDeletedRows.set(key, nextDeleted);
        }
        return;
      }

      const label = progress.table === 'coverage' ? 'coverage' : 'checkpoints';
      if (progress.phase === 'count' && progress.totalRows === 0) {
        return;
      }
      if (progress.phase === 'done' && progress.totalRows === 0) {
        console.log(chalk.gray(`${label}: no obsolete rows`));
        return;
      }

      let bar = bars.get(progress.table);
      if (!bar) {
        bar = new ProgressBar(
          `${label} :current/:total [:bar][:percent] :eta(s)`,
          {
            total: Math.max(1, progress.totalRows),
            width: 24,
          },
        );
        bars.set(progress.table, bar);
        previousDeletedRows.set(progress.table, 0);
      }

      const previousDeleted = previousDeletedRows.get(progress.table) ?? 0;
      const nextDeleted = Math.min(progress.deletedRows, progress.totalRows);
      const delta = Math.max(0, nextDeleted - previousDeleted);
      if (delta > 0) {
        bar.tick(delta);
        previousDeletedRows.set(progress.table, nextDeleted);
      }
    },
  });
  console.log(
    chalk.gray(
      `indicator cache obsolete versions cleaned: coverage=${result.coverageRows}, checkpoints=${result.checkpointRows}`,
    ),
  );
};

export const main = async () => {
  const users = await getUsersToClean();

  await cleanObsoleteIndicatorCacheVersions();

  if (users.length === 0) {
    console.log(chalk.yellow('No users found to clean tests.'));
    process.exit();
  }

  for await (const userName of users) {
    await cleanUserTests(userName);
  }

  process.exit();
};
