import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTradejsConfig } from '../tradejsConfig';
import { readRuntimeLaunchReport } from '../runtimeLaunchReport';

jest.mock('../tradejsConfig', () => ({ loadTradejsConfig: jest.fn() }));
jest.mock('../strategy', () => ({
  getStrategyPluginSource: jest.fn(async () => '@tradejs/strategy-fixture'),
}));

describe('packaged launch reports', () => {
  let projectRoot: string;
  let reportDirectory: string;
  const chart = Buffer.from('test image');
  const report = {
    schema: 'tradejs-launch-report/v1',
    strategy: 'Fixture',
    candidate: 'Selected at launch',
    sourceSha256: 'a'.repeat(64),
    metrics: { winRatePercent: 53.5, maxDrawdownDurationDays: 0 },
    chart: {
      caption: 'Historical equity',
      sha256: createHash('sha256').update(chart).digest('hex'),
    },
  };

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'tradejs-launch-report-'));
    const packageRoot = path.join(
      projectRoot,
      'node_modules/@tradejs/strategy-fixture',
    );
    reportDirectory = path.join(packageRoot, 'launch-reports');
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@tradejs/strategy-fixture',
        exports: {
          './launch-reports/*.json': './launch-reports/*.json',
        },
      }),
    );
    await writeFile(
      path.join(reportDirectory, 'release.json'),
      JSON.stringify(report),
    );
    await writeFile(path.join(reportDirectory, 'release.png'), chart);
    jest.mocked(loadTradejsConfig).mockResolvedValue({
      launchReports: { production: { Fixture: 'release' } },
      runtime: {
        deployments: {
          production: {
            connectorName: 'bybit',
            accountId: 'main',
            strategies: {
              Fixture: { enabled: true, config: {} },
            },
          },
          copy: {
            connectorName: 'bybit',
            accountId: 'copy',
            strategies: {
              Fixture: { enabled: true, config: {} },
            },
          },
        },
      },
    });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('reads the exact package report linked to the deployment and preserves zero days', async () => {
    await expect(
      readRuntimeLaunchReport({
        projectRoot,
        strategyName: 'Fixture',
        deploymentId: 'production',
      }),
    ).resolves.toEqual({
      report,
      chartUrl: `data:image/png;base64,${chart.toString('base64')}`,
    });
    await expect(
      readRuntimeLaunchReport({
        projectRoot,
        strategyName: 'Fixture',
        deploymentId: 'copy',
      }),
    ).resolves.toBeNull();
  });

  it('rejects a chart that differs from the retained report', async () => {
    await writeFile(
      path.join(reportDirectory, 'release.png'),
      'different image',
    );
    await expect(
      readRuntimeLaunchReport({
        projectRoot,
        strategyName: 'Fixture',
        deploymentId: 'production',
      }),
    ).rejects.toThrow('chart checksum does not match');
  });
});
