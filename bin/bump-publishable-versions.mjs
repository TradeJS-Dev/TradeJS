#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);

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
  console.log(`Usage: yarn bump:packages [auto|patch|minor|major|<version>] [--dry-run]

Examples:
  yarn bump:packages auto
  yarn bump:packages patch
  yarn bump:packages minor
  yarn bump:packages 1.0.2
  yarn bump:packages auto --dry-run

The auto strategy compares local package versions with npm and Git tags. It
resumes an incomplete release when necessary and otherwise increments patch.`);
};

const parseArgs = (argv) => {
  let dryRun = false;
  let target = 'patch';
  let targetSet = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    }

    if (targetSet) {
      console.error(`Unexpected extra argument: ${arg}`);
      printUsage();
      process.exit(1);
    }

    target = arg;
    targetSet = true;
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

const getHighestVersion = (versions) => {
  const highest = versions
    .filter(Boolean)
    .map(parseSemver)
    .sort(compareSemver)
    .at(-1);

  if (!highest) {
    throw new Error('No package versions found');
  }

  return formatSemver(highest);
};

const incrementVersion = (version, target) => {
  const next = {
    ...parseSemver(version),
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
};

const resolveTargetVersion = (target, currentVersions) => {
  if (target === 'patch' || target === 'minor' || target === 'major') {
    return incrementVersion(getHighestVersion(currentVersions), target);
  }

  parseSemver(target);
  return target;
};

const fetchPublishedVersion = async (packageName) => {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    {
      headers: {
        accept: 'application/json',
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to read ${packageName} from npm: ${response.status} ${response.statusText}`,
    );
  }

  const manifest = await response.json();
  const version = String(manifest.version ?? '').trim();
  parseSemver(version);
  return version;
};

const hasVersionTag = (version) => {
  const output = execFileSync('git', ['tag', '--list', `v${version}`], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });

  return output.trim() === `v${version}`;
};

const resolveAutomaticVersion = async (entries) => {
  const localVersions = entries.map(({ manifest }) => String(manifest.version));
  const publishedVersions = await Promise.all(
    entries.map(async ({ manifest }) => {
      const packageName = String(manifest.name);
      const version = await fetchPublishedVersion(packageName);
      console.log(`[bump] npm ${packageName}: ${version ?? 'not published'}`);
      return version;
    }),
  );
  const baseline = getHighestVersion([...localVersions, ...publishedVersions]);
  const localAligned = localVersions.every((version) => version === baseline);
  const npmAligned = publishedVersions.every((version) => version === baseline);
  const tagExists = hasVersionTag(baseline);

  if (localAligned && npmAligned && tagExists) {
    return incrementVersion(baseline, 'patch');
  }

  console.log(
    `[bump] Resuming ${baseline}: localAligned=${localAligned}, npmAligned=${npmAligned}, tagExists=${tagExists}`,
  );
  return baseline;
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
const nextVersion =
  target === 'auto'
    ? await resolveAutomaticVersion(manifestEntries)
    : resolveTargetVersion(target, currentVersions);

console.log(`[bump] Target version: ${nextVersion}`);

for (const entry of manifestEntries) {
  const { manifest, absolutePath, relativePath } = entry;
  const currentVersion = String(manifest.version);
  const packageName = String(manifest.name);

  if (currentVersion === nextVersion) {
    console.log(
      `[bump] ${packageName} already at ${nextVersion} (${relativePath})`,
    );
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
