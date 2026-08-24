import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  createProjectSkillBundle,
  readPackagedSkillBundle,
  syncProjectSkillBundle,
  writeProjectSkillBundle,
} from './skillBundle';

const DEFAULT_PROJECT_NAME = 'tradejs-project';
const DEFAULT_PORT = 3000;
const PACKAGED_SKILL_BUNDLE_ROOT = path.resolve(__dirname, 'skill-bundle');
const CANONICAL_SKILLS_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.codex',
  'skills',
);

export interface CreateTradejsOptions {
  targetDir: string;
  install: boolean;
  infra: boolean;
  start: boolean;
  open: boolean;
  port: number;
  updateSkills: boolean;
}

export interface InfrastructurePorts {
  postgres: number;
  redis: number;
  redisInsight: number;
}

const DEFAULT_INFRASTRUCTURE_PORTS: InfrastructurePorts = {
  postgres: 5432,
  redis: 6379,
  redisInsight: 5540,
};

const printUsage = () => {
  console.log(`Create a ready-to-run TradeJS project.

Usage:
  npx create-tradejs [project-directory] [options]

Options:
  --port <number>  Preferred Web UI port (default: 3000)
  --no-install     Only generate project files
  --no-infra       Skip Docker infrastructure and onboarding seed
  --no-start       Do not start the Web UI
  --no-open        Do not open a browser
  --update-skills  Update only the managed TradeJS skill bundle in an existing project
  -h, --help       Show this help`);
};

const readOptionValue = (argv: string[], index: number) => {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${argv[index]} requires a value`);
  }
  return value;
};

export const parseArgs = (argv: string[]): CreateTradejsOptions | null => {
  let targetDir = '';
  let install = true;
  let infra = true;
  let start = true;
  let open = true;
  let port = DEFAULT_PORT;
  let updateSkills = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      return null;
    }
    if (arg === '--no-install') {
      install = false;
      infra = false;
      start = false;
      continue;
    }
    if (arg === '--no-infra') {
      infra = false;
      continue;
    }
    if (arg === '--no-start') {
      start = false;
      continue;
    }
    if (arg === '--no-open') {
      open = false;
      continue;
    }
    if (arg === '--update-skills') {
      updateSkills = true;
      continue;
    }
    if (arg === '--port') {
      port = Number(readOptionValue(argv, index));
      index += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (targetDir) {
      throw new Error(`Unexpected extra project directory: ${arg}`);
    }
    targetDir = arg;
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid port: ${port}`);
  }
  if (!install && (infra || start)) {
    throw new Error('--no-install cannot start infrastructure or the Web UI');
  }
  if (updateSkills) {
    install = false;
    infra = false;
    start = false;
    open = false;
  }

  return {
    targetDir: targetDir || (updateSkills ? '.' : DEFAULT_PROJECT_NAME),
    install,
    infra,
    start,
    open,
    port,
    updateSkills,
  };
};

const packageNameFromDir = (targetDir: string) => {
  const normalized = path
    .basename(targetDir)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_PROJECT_NAME;
};

const createAuthSecret = () => randomBytes(32).toString('hex');

const readProjectSkillBundle = () =>
  existsSync(
    path.join(
      PACKAGED_SKILL_BUNDLE_ROOT,
      '.codex',
      'tradejs-skill-bundle.json',
    ),
  )
    ? readPackagedSkillBundle(PACKAGED_SKILL_BUNDLE_ROOT)
    : createProjectSkillBundle(CANONICAL_SKILLS_ROOT);

export const stageCanonicalSkillBundle = () =>
  writeProjectSkillBundle(CANONICAL_SKILLS_ROOT, PACKAGED_SKILL_BUNDLE_ROOT);

export const buildProjectFiles = (
  targetDir: string,
  port: number,
  infrastructurePorts: InfrastructurePorts = DEFAULT_INFRASTRUCTURE_PORTS,
): Record<string, string> => {
  const packageName = packageNameFromDir(targetDir);
  const authSecret = createAuthSecret();
  const packageVersion =
    String(process.env.CREATE_TRADEJS_PACKAGE_VERSION || '').trim() || 'latest';
  const packageSpec = (name: 'APP' | 'BASE' | 'CLI' | 'CORE') =>
    String(process.env[`CREATE_TRADEJS_${name}_PACKAGE`] || '').trim() ||
    packageVersion;
  const infraPackage = String(
    process.env.CREATE_TRADEJS_INFRA_PACKAGE || '',
  ).trim();
  const dependencies = {
    '@tradejs/app': packageSpec('APP'),
    '@tradejs/base': packageSpec('BASE'),
    '@tradejs/cli': packageSpec('CLI'),
    '@tradejs/core': packageSpec('CORE'),
    ...(infraPackage ? { '@tradejs/infra': infraPackage } : {}),
  };

  return {
    'package.json': `${JSON.stringify(
      {
        name: packageName,
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'tradejs-app dev',
          backtest: 'tradejs backtest',
          doctor: 'tradejs doctor --skip-ml',
          'infra-up': 'tradejs infra-up',
          'infra-down': 'tradejs infra-down',
        },
        dependencies,
        engines: {
          node: '>=20.19',
        },
      },
      null,
      2,
    )}\n`,
    'tradejs.config.ts': `import { basePreset } from '@tradejs/base';
import { defineConfig } from '@tradejs/core/config';

export default defineConfig(basePreset);
`,
    '.env': `AUTH_SECRET=${authSecret}
NEXTAUTH_SECRET=${authSecret}
NEXTAUTH_URL=http://localhost:${port}
APP_URL=http://localhost:${port}
PG_PORT=${infrastructurePorts.postgres}
REDIS_PORT=${infrastructurePorts.redis}
REDIS_INSIGHT_PORT=${infrastructurePorts.redisInsight}
`,
    '.gitignore': `node_modules
.tradejs
.next
data
.env
`,
    'README.md': `# ${packageName}

This project was created with \`create-tradejs\`.

## Start

\`\`\`bash
npm run infra-up
npm run dev
\`\`\`

Open [http://localhost:${port}/routes/dashboard](http://localhost:${port}/routes/dashboard).
On the first launch, TradeJS asks you to create the local root password.

## Codex strategy workflow

The project includes focused TradeJS skills under \`.codex/skills\`. Invoke a
skill with a strategy name, for example:

\`$strategy-candidate-report MarketFlushReversal\`

Use \`$strategy-forward-start <Strategy>\` only when you want Codex to publish
and launch the selected candidate as a bounded forward test. It installs the
exact candidate configuration with \`MAX_LOSS_VALUE=1\` and requires an exact
deployment/account binding.
`,
    ...readProjectSkillBundle().files,
  };
};

export const scaffoldProject = (
  targetDir: string,
  port: number,
  infrastructurePorts: InfrastructurePorts = DEFAULT_INFRASTRUCTURE_PORTS,
) => {
  const absoluteTarget = path.resolve(targetDir);
  if (existsSync(absoluteTarget) && readdirSync(absoluteTarget).length > 0) {
    throw new Error(`Target directory is not empty: ${absoluteTarget}`);
  }

  mkdirSync(absoluteTarget, { recursive: true });
  const files = buildProjectFiles(absoluteTarget, port, infrastructurePorts);
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(absoluteTarget, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents, 'utf8');
  }
  return absoluteTarget;
};

export const updateProjectSkills = (targetDir: string) => {
  const absoluteTarget = path.resolve(targetDir);
  return syncProjectSkillBundle(absoluteTarget, readProjectSkillBundle().files);
};

const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, PROJECT_CWD: cwd },
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with code ${result.status}`,
    );
  }
};

const localBin = (projectDir: string, name: string) =>
  path.join(
    projectDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );

const isPortListening = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ port, host });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });

const canBindPort = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });

const isPortAvailable = async (port: number) => {
  if (
    (await isPortListening(port, '127.0.0.1')) ||
    (await isPortListening(port, '::1'))
  ) {
    return false;
  }

  return canBindPort(port);
};

export const findAvailablePort = async (preferredPort: number) => {
  for (let offset = 0; offset < 20; offset += 1) {
    const port = preferredPort + offset;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting at ${preferredPort}`);
};

const openBrowser = (url: string) => {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.once('error', (error) => {
    console.warn(`Could not open the browser automatically: ${error.message}`);
  });
  child.unref();
};

const waitForApp = async (url: string, child: ReturnType<typeof spawn>) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Web UI exited before it became ready (code ${child.exitCode})`,
      );
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status > 0 && response.status < 500) {
        return;
      }
    } catch {
      // The dev server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const startWebApp = async (
  projectDir: string,
  preferredPort: number,
  shouldOpen: boolean,
) => {
  const port = await findAvailablePort(preferredPort);
  const installUrl = `http://localhost:${port}/routes/install`;
  const appBin = localBin(projectDir, 'tradejs-app');
  const child = spawn(appBin, ['dev', '--port', String(port)], {
    cwd: projectDir,
    env: {
      ...process.env,
      PROJECT_CWD: projectDir,
      PORT: String(port),
      APP_URL: `http://localhost:${port}`,
      NEXTAUTH_URL: `http://localhost:${port}`,
    },
    stdio: 'inherit',
  });
  const launchError = new Promise<never>((_, reject) => {
    child.once('error', reject);
  });

  await Promise.race([waitForApp(installUrl, child), launchError]);
  console.log(`\nTradeJS Web UI: ${installUrl}`);
  if (shouldOpen) {
    openBrowser(installUrl);
  }

  await new Promise<void>((resolve, reject) => {
    child.once('exit', (code, signal) => {
      if (signal || code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Web UI exited with code ${code}`));
    });
  });
};

export const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    printUsage();
    return;
  }

  if (options.updateSkills) {
    const manifest = updateProjectSkills(options.targetDir);
    console.log(
      `Updated TradeJS skill bundle ${manifest.bundleSha256} in ${path.resolve(options.targetDir)}`,
    );
    return;
  }

  const infrastructurePorts = options.infra
    ? {
        postgres: await findAvailablePort(5432),
        redis: await findAvailablePort(6379),
        redisInsight: await findAvailablePort(5540),
      }
    : DEFAULT_INFRASTRUCTURE_PORTS;
  const projectDir = scaffoldProject(
    options.targetDir,
    options.port,
    infrastructurePorts,
  );
  console.log(`Created TradeJS project in ${projectDir}`);

  if (!options.install) {
    console.log('Project files generated. Run npm install to continue.');
    return;
  }

  console.log('\nInstalling TradeJS packages...');
  run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install'],
    projectDir,
  );

  if (options.infra) {
    const tradejs = localBin(projectDir, 'tradejs');
    console.log('\nStarting Redis and Timescale...');
    run(tradejs, ['infra-init'], projectDir);
    run(tradejs, ['infra-up'], projectDir);
    run(tradejs, ['doctor', '--skip-ml'], projectDir);
    console.log('\nInfrastructure is ready. Finish setup in the Web UI.');
  } else {
    console.log('\nInfrastructure setup was skipped.');
  }

  if (options.start) {
    await startWebApp(projectDir, options.port, options.open);
  } else {
    console.log(`\nNext: cd ${options.targetDir} && npm run dev`);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`\ncreate-tradejs failed: ${(error as Error).message}`);
    process.exit(1);
  });
}
