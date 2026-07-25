import { selectStrategy } from '../selectStrategy';
import {
  ALL_EXPORT_STRATEGIES,
  resolveExportStrategy,
} from '../resolveExportStrategy';

jest.mock('../selectStrategy', () => ({
  selectStrategy: jest.fn(),
}));

const selectStrategyMock = jest.mocked(selectStrategy);

describe('resolveExportStrategy', () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
    selectStrategyMock.mockReset();
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

  it('adds all as the final interactive AI export option', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true,
    });
    selectStrategyMock.mockResolvedValue(ALL_EXPORT_STRATEGIES);

    await expect(
      resolveExportStrategy({
        outDir: 'data/ai/export',
        datasetLabel: 'AI',
        promptLabel: 'Select AI export strategy',
        listStrategies: async () => ['trendline', 'volumedivergence'],
        includeAllOption: true,
      }),
    ).resolves.toBe(ALL_EXPORT_STRATEGIES);
    expect(selectStrategyMock).toHaveBeenCalledWith(
      'Select AI export strategy',
      {
        strategies: ['trendline', 'volumedivergence', 'all'],
        defaultStrategy: 'trendline',
      },
    );
  });
});
