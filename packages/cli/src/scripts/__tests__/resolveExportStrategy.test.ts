import { resolveExportStrategy } from '../resolveExportStrategy';

describe('resolveExportStrategy', () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
    jest.restoreAllMocks();
  });

  it('returns explicit strategy without scanning directory', async () => {
    const listStrategies = jest.fn();

    await expect(
      resolveExportStrategy({
        explicitStrategy: 'TrendLine',
        outDir: 'data/ml/export',
        datasetLabel: 'ML',
        promptLabel: 'Select ML export strategy',
        listStrategies,
      }),
    ).resolves.toBe('TrendLine');
    expect(listStrategies).not.toHaveBeenCalled();
  });

  it('returns null when no chunk strategies are available', async () => {
    await expect(
      resolveExportStrategy({
        outDir: 'data/ml/export',
        datasetLabel: 'ML',
        promptLabel: 'Select ML export strategy',
        listStrategies: async () => [],
      }),
    ).resolves.toBeNull();
  });

  it('auto-selects the only available strategy', async () => {
    await expect(
      resolveExportStrategy({
        outDir: 'data/ml/export',
        datasetLabel: 'ML',
        promptLabel: 'Select ML export strategy',
        listStrategies: async () => ['trendline'],
      }),
    ).resolves.toBe('trendline');
  });

  it('throws in non-interactive mode when multiple chunk strategies exist', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });

    await expect(
      resolveExportStrategy({
        outDir: 'data/ml/export',
        datasetLabel: 'ML',
        promptLabel: 'Select ML export strategy',
        listStrategies: async () => ['trendline', 'volumedivergence'],
      }),
    ).rejects.toThrow(
      'Multiple ML chunk strategies found in data/ml/export: trendline, volumedivergence. Pass --strategy.',
    );
  });
});
