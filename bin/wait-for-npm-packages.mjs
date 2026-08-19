#!/usr/bin/env node

import registryConsistency from './npmRegistryConsistency.cjs';

const { PUBLISHABLE_PACKAGES, waitForPackageSet } = registryConsistency;
const args = process.argv.slice(2);
const readOption = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1];
};
const readPositiveNumber = (name, fallback) => {
  const value = Number(readOption(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
};

const version = readOption('--version');
const expectedGitHead = readOption('--git-head');
if (!version || !expectedGitHead) {
  throw new Error(
    'Usage: wait-for-npm-packages.mjs --version <exact-version> --git-head <sha> [--timeout-seconds <seconds>] [--metadata-only]',
  );
}

const timeoutMs = readPositiveNumber('--timeout-seconds', 600) * 1000;
const stableObservations = readPositiveNumber('--stable-observations', 2);
const requireTarball = !args.includes('--metadata-only');

const result = await waitForPackageSet({
  packageNames: PUBLISHABLE_PACKAGES,
  version,
  expectedGitHead,
  timeoutMs,
  stableObservations,
  requireTarball,
  onAttempt: ({
    attempt,
    consecutiveReady,
    stableObservations: requiredObservations,
    results,
    elapsedMs,
  }) => {
    const unavailable = results
      .filter(({ ready }) => !ready)
      .map(({ packageName, reason }) => `${packageName} (${reason})`);
    console.log(
      `[registry] attempt=${attempt} elapsed=${Math.round(
        elapsedMs / 1000,
      )}s ready=${results.length - unavailable.length}/${results.length} stable=${consecutiveReady}/${requiredObservations}`,
    );
    if (unavailable.length) {
      console.log(`[registry] waiting for ${unavailable.join(', ')}`);
    }
  },
});

console.log(
  `[registry] ${PUBLISHABLE_PACKAGES.length} packages at ${version} are consistently visible with gitHead ${expectedGitHead} after ${result.attempt} observations`,
);
