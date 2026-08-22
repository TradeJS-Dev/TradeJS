import {
  buildRuntimeLineage,
  runtimeLineageKey,
  runtimeLineagesComparable,
  runtimeLineagesMatch,
} from '../lib/runtimeLineage';

const buildLineage = (maxLossValue: number | null = 1) =>
  buildRuntimeLineage({
    strategyRevision: 'sr1:5555555555555555',
    deploymentCompositionId: 'dc1:aaaaaaaaaaaaaaaa',
    strategyPackageVersion: '3.0.1',
    strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.1' },
    runtimePackageVersion: '3.2.0',
    config: {
      strategyConfig:
        maxLossValue == null ? {} : { MAX_LOSS_VALUE: maxLossValue },
    },
  });

describe('runtime lineage', () => {
  it('binds lineage to the exact deployment revision and packages', async () => {
    const lineage = await buildLineage();

    expect(lineage).toEqual({
      schemaVersion: 3,
      strategyRevision: 'sr1:5555555555555555',
      deploymentCompositionId: 'dc1:aaaaaaaaaaaaaaaa',
      strategyPackageVersion: '3.0.1',
      strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.1' },
      runtimePackageVersion: '3.2.0',
      maxLossValue: 1,
    });
    expect(runtimeLineageKey(lineage)).toMatch(
      /^v3:dc1:aaaaaaaaaaaaaaaa:sr1:5555555555555555:3\.0\.1:deps:[a-f0-9]{16}:3\.2\.0$/,
    );
  });

  it('separates identity matching from risk-scale comparability', async () => {
    const smallRisk = await buildLineage(1);
    const largeRisk = await buildLineage(10);

    expect(runtimeLineagesMatch(smallRisk, largeRisk)).toBe(true);
    expect(runtimeLineagesComparable(smallRisk, largeRisk)).toBe(false);
    expect(runtimeLineagesComparable(smallRisk, { ...smallRisk })).toBe(true);
  });

  it('changes identity when any package boundary changes', async () => {
    const lineage = await buildLineage();

    expect(
      runtimeLineagesMatch(lineage, {
        ...lineage,
        strategyPackageVersion: '3.0.2',
      }),
    ).toBe(false);
    expect(
      runtimeLineagesMatch(lineage, {
        ...lineage,
        strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.2' },
      }),
    ).toBe(false);
    expect(
      runtimeLineagesMatch(lineage, {
        ...lineage,
        runtimePackageVersion: '3.2.1',
      }),
    ).toBe(false);
  });

  it('stores null when MAX_LOSS_VALUE is unavailable', async () => {
    await expect(buildLineage(null)).resolves.toMatchObject({
      maxLossValue: null,
    });
  });

  it.each([
    { strategyRevision: 'invalid' },
    { deploymentCompositionId: 'invalid' },
    { strategyPackageVersion: '' },
    { runtimePackageVersion: '' },
    { strategyDependencyVersions: {} },
  ])('rejects incomplete current lineage: %j', async (override) => {
    await expect(
      buildRuntimeLineage({
        strategyRevision: 'sr1:5555555555555555',
        deploymentCompositionId: 'dc1:aaaaaaaaaaaaaaaa',
        strategyPackageVersion: '3.0.1',
        strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.1' },
        runtimePackageVersion: '3.2.0',
        config: { strategyConfig: { MAX_LOSS_VALUE: 1 } },
        ...override,
      }),
    ).rejects.toThrow();
  });
});
