const {
  buildCleanupPlan,
  parseVersionList,
}: {
  parseVersionList: (value: string) => string[];
  buildCleanupPlan: (params: {
    versions: string[];
    protectedVersions: string[];
    packageStates: Array<{
      name: string;
      tags: Record<string, string>;
      versions: string[];
    }>;
  }) => string[];
} = require('../npmCleanup.cjs');

describe('npm cleanup plan', () => {
  const packageStates = [
    {
      name: '@tradejs/types',
      tags: { latest: '3.1.7', beta: '3.1.8-beta.10' },
      versions: ['3.1.4', '3.1.7', '3.1.8-beta.10'],
    },
  ];

  it('builds only exact package-version deletion targets', () => {
    expect(
      buildCleanupPlan({
        versions: parseVersionList('3.1.4'),
        protectedVersions: parseVersionList('3.1.6,3.1.7'),
        packageStates,
      }),
    ).toEqual(['@tradejs/types@3.1.4']);
  });

  it('rejects protected and dist-tagged versions', () => {
    expect(() =>
      buildCleanupPlan({
        versions: ['3.1.7'],
        protectedVersions: ['3.1.7'],
        packageStates,
      }),
    ).toThrow('Protected runtime version');
    expect(() =>
      buildCleanupPlan({
        versions: ['3.1.8-beta.10'],
        protectedVersions: [],
        packageStates,
      }),
    ).toThrow('Tagged npm version');
  });
});
