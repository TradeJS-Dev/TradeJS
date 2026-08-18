#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import cleanup from './npmCleanup.cjs';

const { PUBLISHABLE_PACKAGES, buildCleanupPlan, parseVersionList } = cleanup;
const args = process.argv.slice(2);
const readOption = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1];
};
const apply = args.includes('--apply');
const versions = parseVersionList(readOption('--versions'));
const protectedVersions = parseVersionList(readOption('--protect'));

const packageStates = await Promise.all(
  PUBLISHABLE_PACKAGES.map(async (name) => {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok)
      throw new Error(`${name}: registry returned ${response.status}`);
    const data = await response.json();
    return {
      name,
      tags: data['dist-tags'] ?? {},
      versions: Object.keys(data.versions ?? {}),
    };
  }),
);
const plan = buildCleanupPlan({ versions, protectedVersions, packageStates });

console.log(
  JSON.stringify({ apply, versions, protectedVersions, plan }, null, 2),
);
if (!apply) process.exit(0);

for (const spec of plan) {
  execFileSync('npm', ['unpublish', spec, '--force'], {
    stdio: 'inherit',
    env: process.env,
  });
}

for (const spec of plan) {
  try {
    execFileSync('npm', ['view', spec, 'version'], {
      stdio: 'ignore',
      env: process.env,
    });
    throw new Error(`Version still exists after unpublish: ${spec}`);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Version still exists')
    ) {
      throw error;
    }
  }
}
