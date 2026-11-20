/** @jest-environment node */
import { readDataCoverageSnapshot } from '@tradejs/infra/timescale/dataCoverage';
import {
  getCachedDataCoverage,
  invalidateDataCoverage,
} from '../dataCoverageCache';
jest.mock('@tradejs/infra/timescale/dataCoverage', () => ({
  readDataCoverageSnapshot: jest.fn(),
}));
jest.mock('@tradejs/infra/redis', () => ({
  getHashJsonField: jest.fn(),
  getHashJsonValues: jest.fn(),
  setHashJsonField: jest.fn(),
}));
it('bounds pending work while sharing an existing scan', () => {
  jest
    .mocked(readDataCoverageSnapshot)
    .mockImplementation(() => new Promise(() => {}));
  const request = (dataset: string) => ({
    dataset,
    period: { from: 0, to: 100 },
    refresh: false,
    annual: false,
  });
  const first = getCachedDataCoverage(request('dataset0'));
  expect(getCachedDataCoverage(request('dataset0')).result).toBe(first.result);
  for (let i = 1; i < 8; i++) getCachedDataCoverage(request(`dataset${i}`));
  expect(() => getCachedDataCoverage(request('extra'))).toThrow('busy');
  expect(readDataCoverageSnapshot).toHaveBeenCalledTimes(8);
  for (let i = 0; i < 8; i++) invalidateDataCoverage(`dataset${i}`, 0);
});
