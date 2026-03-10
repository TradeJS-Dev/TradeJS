import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEV_COMPOSE_FILE = 'docker-compose.dev.yml';

const getProjectRoot = (): string => {
  const fromEnv = String(process.env.PROJECT_CWD || '').trim();
  return fromEnv ? path.resolve(fromEnv) : process.cwd();
};

const DEV_COMPOSE_TEMPLATE = `services:
  timescale:
    image: timescale/timescaledb:latest-pg16
    container_name: tradejs-timescale
    environment:
      POSTGRES_USER: \${PG_USER:-app}
      POSTGRES_PASSWORD: \${PG_PASSWORD:-app}
      POSTGRES_DB: \${PG_DB:-app}
    ports:
      - "5432:5432"
    volumes:
      - tradejs_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${PG_USER:-app} -d \${PG_DB:-app}"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  redis:
    image: redis/redis-stack:latest
    container_name: tradejs-redis
    ports:
      - "6379:6379"
      - "5540:8001"
    volumes:
      - tradejs_redisdata:/data
    restart: unless-stopped

volumes:
  tradejs_pgdata:
  tradejs_redisdata:
`;

const getDevComposePath = (): string =>
  path.resolve(getProjectRoot(), DEV_COMPOSE_FILE);

export const initDevComposeFile = (): string => {
  const composePath = getDevComposePath();

  if (existsSync(composePath)) {
    console.log(
      chalk.yellow(
        `${DEV_COMPOSE_FILE} already exists. Keeping user-defined file as is.`,
      ),
    );
    return composePath;
  }

  writeFileSync(composePath, DEV_COMPOSE_TEMPLATE, 'utf8');
  console.log(chalk.green(`Created ${DEV_COMPOSE_FILE} in project root`));
  return composePath;
};

export const requireDevComposeFile = (): string => {
  const composePath = path.resolve(getProjectRoot(), DEV_COMPOSE_FILE);

  if (existsSync(composePath)) {
    console.log(chalk.gray(`Using existing ${DEV_COMPOSE_FILE}`));
    return composePath;
  }

  throw new Error(
    `${DEV_COMPOSE_FILE} not found in project root. Run "npx @tradejs/cli infra-init" first.`,
  );
};

export const runDockerCompose = (composePath: string, args: string[]): void => {
  const result = spawnSync('docker', ['compose', '-f', composePath, ...args], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
};
