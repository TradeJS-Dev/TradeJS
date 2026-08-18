'use strict';

const PUBLISHABLE_PACKAGES = [
  '@tradejs/types',
  '@tradejs/infra',
  '@tradejs/core',
  '@tradejs/node',
  '@tradejs/indicators',
  '@tradejs/connectors',
  '@tradejs/cli',
  '@tradejs/app',
  'create-tradejs',
];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const parseVersionList = (value) => {
  const versions = [
    ...new Set(
      String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (
    !versions.length ||
    versions.some((version) => !EXACT_VERSION.test(version))
  ) {
    throw new Error('Expected a comma-separated list of exact npm versions');
  }
  return versions;
};

const buildCleanupPlan = ({ versions, protectedVersions, packageStates }) => {
  const protectedSet = new Set(protectedVersions);
  const taggedVersions = new Set(
    packageStates.flatMap((state) => Object.values(state.tags ?? {})),
  );
  for (const version of versions) {
    if (protectedSet.has(version)) {
      throw new Error(
        `Protected runtime version cannot be unpublished: ${version}`,
      );
    }
    if (taggedVersions.has(version)) {
      throw new Error(`Tagged npm version cannot be unpublished: ${version}`);
    }
  }

  return packageStates.flatMap((state) =>
    versions.map((version) => {
      if (!state.versions.includes(version)) {
        throw new Error(`Version is not published: ${state.name}@${version}`);
      }
      return `${state.name}@${version}`;
    }),
  );
};

module.exports = {
  PUBLISHABLE_PACKAGES,
  buildCleanupPlan,
  parseVersionList,
};
