const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  collectSandboxRuntimePackageVersions,
} = require('../runtimePackageManifest');

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

const makeTemporaryRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradejs-sandbox-'));
  temporaryRoots.push(root);
  return root;
};

const writeManifest = async (root, name, manifest) => {
  const target = name
    ? path.join(root, 'node_modules', ...name.split('/'), 'package.json')
    : path.join(root, 'package.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(manifest));
};

describe('sandbox runtime package manifest', () => {
  it('records every transitive TradeJS dependency and peer exactly once', async () => {
    const root = await makeTemporaryRoot();
    await writeManifest(root, null, {
      name: '@tradejs/example-sandbox',
      version: '1.0.0',
      dependencies: { '@tradejs/cli': '3.2.0', ioredis: '5.0.0' },
    });
    await writeManifest(root, '@tradejs/cli', {
      name: '@tradejs/cli',
      version: '3.2.0',
      dependencies: { '@tradejs/node': '3.2.0' },
      peerDependencies: { '@tradejs/types': '^3.2.0' },
    });
    await writeManifest(root, '@tradejs/node', {
      name: '@tradejs/node',
      version: '3.2.0',
      dependencies: { '@tradejs/types': '3.2.0' },
    });
    await writeManifest(root, '@tradejs/types', {
      name: '@tradejs/types',
      version: '3.2.0',
    });

    await expect(collectSandboxRuntimePackageVersions(root)).resolves.toEqual({
      '@tradejs/cli': '3.2.0',
      '@tradejs/example-sandbox': '1.0.0',
      '@tradejs/node': '3.2.0',
      '@tradejs/types': '3.2.0',
    });
  });

  it('rejects a dependency whose installed package identity differs', async () => {
    const root = await makeTemporaryRoot();
    await writeManifest(root, null, {
      name: '@tradejs/example-sandbox',
      version: '1.0.0',
      dependencies: { '@tradejs/cli': '3.2.0' },
    });
    await writeManifest(root, '@tradejs/cli', {
      name: '@tradejs/core',
      version: '3.2.0',
    });

    await expect(collectSandboxRuntimePackageVersions(root)).rejects.toThrow(
      'Invalid sandbox package identity: @tradejs/cli',
    );
  });
});
