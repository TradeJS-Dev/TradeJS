type PackageManifest = {
  name: string;
  exports?: Record<
    string,
    | string
    | {
        types?: string;
        import?: string;
        require?: string;
      }
  >;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type PackageInfo = { manifest: PackageManifest };

const {
  buildManifestWorkspaceGraph,
  validateManifestWorkspaceGraph,
  validatePublicExportShape,
}: {
  buildManifestWorkspaceGraph: (
    packages: PackageInfo[],
  ) => Map<string, Set<string>>;
  validateManifestWorkspaceGraph: (params: {
    packages: PackageInfo[];
    allowedWorkspaceDependencies: Map<string, Set<string>>;
  }) => { errors: string[]; graph: Map<string, Set<string>> };
  validatePublicExportShape: (params: {
    packages: PackageInfo[];
    subpathFirstPackageNames: Set<string>;
  }) => string[];
} = require('../architectureGraph.cjs');

const packageInfo = (
  name: string,
  fields: Omit<PackageManifest, 'name'> = {},
): PackageInfo => ({ manifest: { name, ...fields } });

describe('architecture manifest graph', () => {
  it('uses runtime manifests while excluding dev-only test dependencies', () => {
    const graph = buildManifestWorkspaceGraph([
      packageInfo('@tradejs/core', {
        dependencies: { '@tradejs/types': 'workspace:^' },
        devDependencies: { '@tradejs/strategies': 'workspace:^' },
      }),
      packageInfo('@tradejs/types'),
      packageInfo('@tradejs/strategies'),
    ]);

    expect([...graph.get('@tradejs/core')!]).toEqual(['@tradejs/types']);
  });

  it('rejects forbidden dependencies declared without source imports', () => {
    const packages = [
      packageInfo('@tradejs/core', {
        dependencies: { '@tradejs/infra': 'workspace:^' },
      }),
      packageInfo('@tradejs/infra'),
    ];

    const { errors } = validateManifestWorkspaceGraph({
      packages,
      allowedWorkspaceDependencies: new Map([
        ['@tradejs/core', new Set()],
        ['@tradejs/infra', new Set()],
      ]),
    });

    expect(errors).toContain(
      '@tradejs/core: forbidden runtime manifest dependency @tradejs/core -> @tradejs/infra',
    );
  });

  it('rejects cycles expressed only through package manifests', () => {
    const packages = [
      packageInfo('@tradejs/base', {
        dependencies: { '@tradejs/connectors': 'workspace:^' },
      }),
      packageInfo('@tradejs/connectors', {
        peerDependencies: { '@tradejs/base': 'workspace:^' },
      }),
    ];

    const { errors } = validateManifestWorkspaceGraph({
      packages,
      allowedWorkspaceDependencies: new Map([
        ['@tradejs/base', new Set(['@tradejs/connectors'])],
        ['@tradejs/connectors', new Set(['@tradejs/base'])],
      ]),
    });

    expect(errors).toContain(
      'workspace manifest dependency cycle: @tradejs/base -> @tradejs/connectors -> @tradejs/base',
    );
  });
});

describe('architecture public exports', () => {
  it('rejects root exports from subpath-first packages', () => {
    const errors = validatePublicExportShape({
      packages: [
        packageInfo('@tradejs/core', {
          exports: {
            '.': {
              types: './dist/index.d.ts',
              import: './dist/index.mjs',
              require: './dist/index.js',
            },
          },
        }),
      ],
      subpathFirstPackageNames: new Set(['@tradejs/core']),
    });

    expect(errors).toContain('@tradejs/core: root package export is forbidden');
  });

  it('requires conventional build targets for every public subpath', () => {
    const errors = validatePublicExportShape({
      packages: [
        packageInfo('@tradejs/node', {
          exports: {
            './runtimeTrades': {
              types: './dist/runtimeTrades.d.ts',
              import: './dist/runtime-trades.mjs',
              require: './dist/runtimeTrades.js',
            },
          },
        }),
      ],
      subpathFirstPackageNames: new Set(['@tradejs/node']),
    });

    expect(errors).toEqual([
      '@tradejs/node: export ./runtimeTrades import target must be ./dist/runtimeTrades.mjs',
    ]);
  });
});
