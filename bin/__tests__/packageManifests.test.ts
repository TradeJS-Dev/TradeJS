import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

const readManifest = (relativePath: string) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as {
    dependencies?: Record<string, string>;
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
});
