#!/usr/bin/env node

import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import nextEnv from '@next/env';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = nextEnv;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');

const command = process.argv[2] || 'dev';
const rawArgs = process.argv.slice(3);
const projectCwd = path.resolve(
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd(),
);

process.env.PROJECT_CWD = projectCwd;

const dev = command === 'dev';
loadEnvConfig(projectCwd, dev, console);

const nextBin = require.resolve('next/dist/bin/next');
const args = [nextBin, command, ...rawArgs];

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
