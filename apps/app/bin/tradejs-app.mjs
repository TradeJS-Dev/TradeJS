#!/usr/bin/env node

import { spawn } from 'child_process';
import { createRequire } from 'module';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import nextEnv from '@next/env';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = nextEnv;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');
const LOCAL_DEV_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

const command = process.argv[2] || 'dev';
const rawArgs = process.argv.slice(3);
const projectCwd = path.resolve(
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd(),
);

process.env.PROJECT_CWD = projectCwd;

const dev = command === 'dev';
loadEnvConfig(projectCwd, dev, console);

function parsePort(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readArgValue(args, flags) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flags.includes(arg)) {
      return args[index + 1] || null;
    }
    const matchedFlag = flags.find((flag) => arg.startsWith(`${flag}=`));
    if (matchedFlag) {
      return arg.slice(matchedFlag.length + 1) || null;
    }
  }

  return null;
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, attempts = 20) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  return null;
}

function syncLocalUrlEnv(name, fromPort, toPort) {
  const rawValue = String(process.env[name] || '').trim();
  if (!rawValue) {
    process.env[name] = `http://localhost:${toPort}`;
    return;
  }

  try {
    const url = new URL(rawValue);
    const currentPort =
      parsePort(url.port) || (url.protocol === 'https:' ? 443 : 80);
    if (!LOCAL_DEV_HOSTNAMES.has(url.hostname) || currentPort !== fromPort) {
      return;
    }
    url.port = String(toPort);
    process.env[name] = url.toString();
  } catch {
    // Ignore invalid URLs and leave user-provided values untouched.
  }
}

async function main() {
  const nextBin = require.resolve('next/dist/bin/next');
  const args = [nextBin, command, ...rawArgs];
  const explicitPort = parsePort(readArgValue(rawArgs, ['-p', '--port']));
  const hasBundlerFlag = rawArgs.some(
    (arg) => arg === '--webpack' || arg === '--turbopack',
  );

  if ((command === 'dev' || command === 'build') && !hasBundlerFlag) {
    args.push('--webpack');
  }

  if (dev && explicitPort === null) {
    const requestedPort = parsePort(process.env.PORT) || 3000;
    const resolvedPort = await findAvailablePort(requestedPort);

    if (resolvedPort === null) {
      console.error(
        `[tradejs-app] no available dev port found starting at ${requestedPort}`,
      );
      process.exit(1);
    }

    process.env.PORT = String(resolvedPort);
    args.push('-p', String(resolvedPort));

    if (resolvedPort !== requestedPort) {
      syncLocalUrlEnv('APP_URL', requestedPort, resolvedPort);
      syncLocalUrlEnv('NEXTAUTH_URL', requestedPort, resolvedPort);
      console.warn(
        `[tradejs-app] port ${requestedPort} is busy, using ${resolvedPort} instead`,
      );
    }
  }

  if (
    command === 'start' &&
    !rawArgs.includes('-H') &&
    !rawArgs.includes('--hostname')
  ) {
    args.push('-H', '0.0.0.0');
  }

  const child = spawn(process.execPath, args, {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('[tradejs-app] failed to start Next.js:', error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('[tradejs-app] failed to initialize:', error);
  process.exit(1);
});
