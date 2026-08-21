import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const readWorkflow = (name: string) =>
  fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8');

describe('npm release workflows', () => {
  it('publishes push builds only as beta and never updates stable Git state', () => {
    const workflow = readWorkflow('publish-images.yml');

    expect(workflow).toContain('resolveBetaVersion');
    expect(workflow).toContain('--tag beta-candidate');
    expect(workflow).toContain('wait-for-npm-packages.mjs');
    expect(workflow).toContain('--stable-observations 2');
    expect(
      workflow.indexOf('Wait for complete beta registry consistency'),
    ).toBeLessThan(workflow.indexOf('Quickstart beta browser e2e'));
    expect(workflow).toContain("YARN_NPM_PUBLISH_PROVENANCE: 'false'");
    expect(workflow).toContain('npm dist-tag add');
    expect(workflow.indexOf('sandbox:e2e')).toBeLessThan(
      workflow.indexOf('npm dist-tag add'),
    );
    expect(workflow).not.toContain('TradeJS-Project.git');
    expect(workflow).not.toContain('tradejs-project-beta');
    expect(workflow).toContain("PUPPETEER_SKIP_DOWNLOAD: 'true'");
    expect(workflow).not.toContain('yarn bump:packages auto');
    expect(workflow).toContain("npm view '@tradejs/types@latest' version");
    expect(workflow).not.toContain(
      "require('./packages/types/package.json').version",
    );
    expect(workflow).not.toContain('git push origin HEAD:stable');
    expect(workflow).not.toContain('Tag successful release');
    expect(workflow).toContain('dorny/paths-filter@v4');
    expect(workflow).toContain('actions/cache@v6');
    expect(workflow).toContain('docker/setup-buildx-action@v4');
    expect(workflow).toContain('docker/login-action@v4');
    expect(workflow).toContain('docker/build-push-action@v7');
    expect(workflow).not.toContain('tradejs-agent:latest');
    expect(workflow).not.toContain('tradejs-ml-infer:latest');
    expect(workflow).toContain('Verify unchanged source tree');
    expect(workflow).toContain('Build versioned packages');
    expect(workflow.indexOf('Verify unchanged source tree')).toBeLessThan(
      workflow.indexOf('Resolve beta version'),
    );
    expect(workflow.indexOf('Resolve beta version')).toBeLessThan(
      workflow.indexOf('Build versioned packages'),
    );
    const versionedPackagePhase = workflow.slice(
      workflow.indexOf('Resolve beta version'),
      workflow.indexOf('Publish beta candidate packages'),
    );
    expect(versionedPackagePhase).not.toContain('yarn unit');
  });

  it('promotes the current verified beta on a weekly schedule', () => {
    const workflow = readWorkflow('promote-release.yml');

    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '0 3 * * 1'");
    expect(workflow).not.toMatch(/confirm[_-]promotion/);
    expect(workflow).toContain('publish-images.yml/runs');
    expect(workflow).not.toMatch(/^\s*environment:/m);
    expect(workflow).toContain('--tag stable-candidate');
    expect(workflow).toContain('Wait for complete stable registry consistency');
    expect(workflow).toContain('wait-for-npm-packages.mjs');
    expect(workflow.indexOf('--tag stable-candidate')).toBeLessThan(
      workflow.indexOf('Wait for complete stable registry consistency'),
    );
    expect(
      workflow.indexOf('Wait for complete stable registry consistency'),
    ).toBeLessThan(workflow.indexOf('Quickstart stable browser e2e'));
    expect(workflow.indexOf('sandbox:e2e')).toBeLessThan(
      workflow.indexOf('Tag the verified stable source'),
    );
    expect(workflow.indexOf('Tag the verified stable source')).toBeLessThan(
      workflow.indexOf('Promote all verified stable candidates to latest'),
    );
    expect(workflow).toContain("npm view '@tradejs/types@latest' version");
    expect(workflow).not.toContain('git push origin HEAD:stable');
    expect(workflow).not.toContain('TAG_ONLY');
    expect(workflow).toContain('Verify unchanged source tree');
    expect(workflow).toContain('Build versioned packages');
    expect(workflow.indexOf('Verify unchanged source tree')).toBeLessThan(
      workflow.indexOf('Resolve stable version'),
    );
    const versionedPackagePhase = workflow.slice(
      workflow.indexOf('Resolve stable version'),
      workflow.indexOf('Publish stable package candidates'),
    );
    expect(versionedPackagePhase).not.toContain('yarn unit');
  });

  it('keeps source manifests explicitly detached from registry versions', () => {
    const manifests = [
      'packages/types/package.json',
      'packages/infra/package.json',
      'packages/core/package.json',
      'packages/node/package.json',
      'packages/indicators/package.json',
      'packages/connectors/package.json',
      'packages/cli/package.json',
      'apps/app/package.json',
      'packages/create-tradejs/package.json',
    ].map((relativePath) =>
      JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')),
    );

    expect(new Set(manifests.map(({ version }) => version))).toEqual(
      new Set(['3.1.0+development']),
    );
  });

  it('keeps npm cleanup exact and separate from publishing', () => {
    const workflow = readWorkflow('npm-cleanup.yml');

    expect(workflow).toContain('versions_csv');
    expect(workflow).not.toMatch(/confirm[_-]unpublish/);
    expect(workflow).toContain('npm-cleanup.mjs');
    expect(workflow).not.toMatch(/^\s*environment:/m);
  });
});
