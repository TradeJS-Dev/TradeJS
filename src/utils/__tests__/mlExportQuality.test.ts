import {
  createMlExportQualityAccumulator,
  deriveTrainFeatureColumns,
  formatMlExportQualityIssues,
  ingestMlExportQualityRow,
  summarizeMlExportQuality,
} from '../mlExportQuality';

describe('mlExport quality', () => {
  it('detects all-zero and high-zero numeric feature columns', () => {
    const headers = ['label', 'profit', 'signalId', 'f_all_zero', 'f_high_zero', 'f_ok'];
    const features = deriveTrainFeatureColumns(headers);
    const acc = createMlExportQualityAccumulator();

    for (let i = 0; i < 20; i += 1) {
      ingestMlExportQualityRow(acc, {
        label: i % 2,
        profit: i,
        signalId: `s-${i}`,
        f_all_zero: 0,
        f_high_zero: i === 19 ? 1 : 0,
        f_ok: i,
      });
    }

    const summary = summarizeMlExportQuality(acc, features, {
      highZeroThreshold: 0.95,
    });

    expect(summary.allZeroColumns).toContain('f_all_zero');
    expect(summary.highZeroColumns).toContain('f_high_zero');
    expect(summary.issues.some((issue) => issue.code === 'all_zero')).toBe(true);
    expect(summary.issues.some((issue) => issue.code === 'high_zero')).toBe(true);
  });

  it('respects high-zero whitelist', () => {
    const headers = ['label', 'profit', 'signalId', 'f_sparse_whitelisted'];
    const features = deriveTrainFeatureColumns(headers);
    const acc = createMlExportQualityAccumulator();

    for (let i = 0; i < 20; i += 1) {
      ingestMlExportQualityRow(acc, {
        label: i % 2,
        profit: i,
        signalId: `s-${i}`,
        f_sparse_whitelisted: i === 19 ? 1 : 0,
      });
    }

    const summary = summarizeMlExportQuality(acc, features, {
      highZeroThreshold: 0.95,
      highZeroWhitelist: ['f_sparse_whitelisted'],
    });

    expect(summary.highZeroColumns).toHaveLength(0);
    expect(summary.issues).toHaveLength(0);
  });

  it('flags NaN/inf and zero-variance continuous columns', () => {
    const headers = ['label', 'profit', 'signalId', 'f_nan', 'f_inf', 'f_flat', 'f_binary'];
    const features = deriveTrainFeatureColumns(headers);
    const acc = createMlExportQualityAccumulator();

    ingestMlExportQualityRow(acc, {
      label: 1,
      profit: 1,
      signalId: 'a',
      f_nan: 1,
      f_inf: 1,
      f_flat: 5,
      f_binary: 0,
    });
    ingestMlExportQualityRow(acc, {
      label: 0,
      profit: -1,
      signalId: 'b',
      f_nan: 'NaN',
      f_inf: 'Infinity',
      f_flat: 5,
      f_binary: 1,
    });
    ingestMlExportQualityRow(acc, {
      label: 1,
      profit: 2,
      signalId: 'c',
      f_nan: 3,
      f_inf: 2,
      f_flat: 5,
      f_binary: 0,
    });

    const summary = summarizeMlExportQuality(acc, features);

    expect(summary.nanOrInfColumns).toEqual(expect.arrayContaining(['f_nan', 'f_inf']));
    expect(summary.zeroVarianceContinuousColumns).toContain('f_flat');
    expect(summary.zeroVarianceContinuousColumns).not.toContain('f_binary');
  });

  it('excludes label/profit/signalId from train features', () => {
    const headers = ['label', 'profit', 'signalId', 'entryTimestamp', 'featureA'];
    const features = deriveTrainFeatureColumns(headers);

    expect(features).toEqual(['featureA']);
  });

  it('formats issue summary lines', () => {
    const headers = ['label', 'profit', 'signalId', 'f_all_zero'];
    const features = deriveTrainFeatureColumns(headers);
    const acc = createMlExportQualityAccumulator();
    ingestMlExportQualityRow(acc, {
      label: 1,
      profit: 1,
      signalId: 'a',
      f_all_zero: 0,
    });

    const summary = summarizeMlExportQuality(acc, features);
    const lines = formatMlExportQualityIssues('train', summary, 5);

    expect(lines[0]).toContain('train: features=1');
    expect(lines.some((line) => line.includes('[all_zero] f_all_zero'))).toBe(true);
  });
});
