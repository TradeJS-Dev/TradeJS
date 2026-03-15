#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const PUBLISHABLE_MANIFESTS = [
  'packages/types/package.json',
  'packages/infra/package.json',
  'packages/core/package.json',
  'packages/node/package.json',
  'packages/indicators/package.json',
  'packages/strategies/package.json',
  'packages/connectors/package.json',
  'packages/base/package.json',
  'packages/cli/package.json',
  'apps/app/package.json',
];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

const printUsage = () => {
  console.log(`Usage: yarn bump:packages [patch|minor|major|<version>] [--dry-run]

Examples:
  yarn bump:packages patch
  yarn bump:packages minor
  yarn bump:packages 1.0.2
  yarn bump:packages patch --dry-run`);
};

const parseArgs = (argv) => {
  let dryRun = false;
  let target = 'patch';

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    }

    if (target !== 'patch') {
      console.error(`Unexpected extra argument: ${arg}`);
      printUsage();
      process.exit(1);
    }

    target = arg;
  }

  return { dryRun, target };
};

const parseSemver = (version) => {
  const match = SEMVER_RE.exec(String(version).trim());
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    suffix: match[4] ?? '',
  };
};

const compareSemver = (left, right) => {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return 0;
};

const formatSemver = ({ major, minor, patch, suffix = '' }) =>
  `${major}.${minor}.${patch}${suffix}`;

const resolveTargetVersion = (target, currentVersions) => {
  if (target === 'patch' || target === 'minor' || target === 'major') {
    const highest = currentVersions
      .map(parseSemver)
      .sort(compareSemver)
      .at(-1);

    if (!highest) {
      throw new Error('No publishable package versions found');
    }

    const next = {
      major: highest.major,
      minor: highest.minor,
      patch: highest.patch,
      suffix: '',
    };

    if (target === 'patch') {
      next.patch += 1;
    } else if (target === 'minor') {
      next.minor += 1;
      next.patch = 0;
    } else {
      next.major += 1;
      next.minor = 0;
      next.patch = 0;
    }

    return formatSemver(next);
  }

  parseSemver(target);
  return target;
};

const manifestEntries = PUBLISHABLE_MANIFESTS.map((relativePath) => {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const manifest = JSON.parse(raw);
  return {
    relativePath,
    absolutePath,
    raw,
    manifest,
  };
});

const { dryRun, target } = parseArgs(process.argv.slice(2));
const currentVersions = manifestEntries.map(({ manifest }) => manifest.version);
const nextVersion = resolveTargetVersion(target, currentVersions);

console.log(`[bump] Target version: ${nextVersion}`);

for (const entry of manifestEntries) {
  const { manifest, absolutePath, relativePath } = entry;
  const currentVersion = String(manifest.version);
  const packageName = String(manifest.name);

  if (currentVersion === nextVersion) {
    console.log(`[bump] ${packageName} already at ${nextVersion} (${relativePath})`);
    continue;
  }

  console.log(`[bump] ${packageName}: ${currentVersion} -> ${nextVersion}`);

  if (dryRun) {
    continue;
  }

  manifest.version = nextVersion;
  fs.writeFileSync(
    absolutePath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

if (dryRun) {
  console.log('[bump] Dry run only, no files changed.');
}
