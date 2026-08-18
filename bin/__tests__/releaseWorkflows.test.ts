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
    expect(workflow).toContain('npm dist-tag add');
    expect(workflow.indexOf('beta-runtime-smoke.sh')).toBeLessThan(
      workflow.indexOf('npm dist-tag add'),
    );
    expect(workflow).toContain('beta-runtime-smoke.sh');
    expect(workflow).toContain('yarn install --no-immutable');
    expect(workflow).not.toContain('yarn bump:packages auto');
    expect(workflow).not.toContain('git push origin HEAD:stable');
    expect(workflow).not.toContain('Tag successful release');
  });

  it('promotes the current verified beta on a weekly schedule', () => {
    const workflow = readWorkflow('promote-release.yml');

    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '0 3 * * 1'");
    expect(workflow).toContain('confirm_promotion');
    expect(workflow).toContain('publish-images.yml/runs');
    expect(workflow).toContain('environment: npm-production');
    expect(workflow).toContain('--tag stable-candidate');
    expect(workflow.indexOf('sandbox:e2e')).toBeLessThan(
      workflow.indexOf('Promote all verified stable candidates to latest'),
    );
    expect(workflow).toContain("TAG_ONLY: 'false'");
  });

  it('keeps npm cleanup explicit, confirmed, and separate from publishing', () => {
    const workflow = readWorkflow('npm-cleanup.yml');

    expect(workflow).toContain('versions_csv');
    expect(workflow).toContain('confirm_unpublish');
    expect(workflow).toContain('npm-cleanup.mjs');
    expect(workflow).toContain('environment: npm-production');
  });
});
