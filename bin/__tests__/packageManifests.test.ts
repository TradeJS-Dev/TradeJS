import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

const readManifest = (relativePath: string) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };

describe('published package manifests', () => {
  it('@tradejs/node provides every required ts-node peer at runtime', () => {
    const nodeManifest = readManifest('packages/node/package.json');
    const tsNodeManifest = readManifest('node_modules/ts-node/package.json');
    const provided = {
      ...nodeManifest.dependencies,
      ...nodeManifest.peerDependencies,
    };
    const requiredTsNodePeers = Object.keys(
      tsNodeManifest.peerDependencies ?? {},
    ).filter(
      (name) => tsNodeManifest.peerDependenciesMeta?.[name]?.optional !== true,
    );

    expect(requiredTsNodePeers).toEqual(['@types/node', 'typescript']);
    expect(
      requiredTsNodePeers.filter((name) => !Object.hasOwn(provided, name)),
    ).toEqual([]);
  });

  it('uses one exact Strategy Kit release across engine consumers', () => {
    const rootManifest = readManifest('package.json');
    const cliManifest = readManifest('packages/cli/package.json');
    const nodeManifest = readManifest('packages/node/package.json');
    const sandboxManifest = readManifest('examples/sandbox/package.json');
    const strategyKitVersion =
      rootManifest.devDependencies?.['@tradejs/strategy-kit'];

    expect(strategyKitVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cliManifest.dependencies?.['@tradejs/strategy-kit']).toBe(
      strategyKitVersion,
    );
    expect(nodeManifest.devDependencies?.['@tradejs/strategy-kit']).toBe(
      strategyKitVersion,
    );
    expect(sandboxManifest.dependencies?.['@tradejs/strategy-kit']).toBe(
      strategyKitVersion,
    );
  });
});
