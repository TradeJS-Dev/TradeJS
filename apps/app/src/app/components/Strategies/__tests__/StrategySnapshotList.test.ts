import { getSnapshotCardRowHeight } from '../StrategySnapshotList';

describe('StrategySnapshotList layout', () => {
  it('uses the same compact card rhythm as backtests on the AI tab', () => {
    expect(getSnapshotCardRowHeight('ai')).toBe(548);
  });

  it('keeps the existing replay card height', () => {
    expect(getSnapshotCardRowHeight('replay')).toBe(620);
  });
});
