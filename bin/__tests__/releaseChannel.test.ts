const {
  resolveBetaVersion,
  resolveStableVersion,
}: {
  resolveBetaVersion: (version: string, runNumber: string) => string;
  resolveStableVersion: (version: string) => string;
} = require('../releaseChannel.cjs');

describe('npm release channels', () => {
  it('derives a unique beta from the next patch without changing stable', () => {
    expect(resolveBetaVersion('3.1.7', '321')).toBe('3.1.8-beta.321');
  });

  it('promotes only a canonical beta version to its stable patch', () => {
    expect(resolveStableVersion('3.1.8-beta.321')).toBe('3.1.8');
    expect(() => resolveStableVersion('3.1.8')).toThrow(
      'Expected a beta version',
    );
  });

  it('rejects unsafe channel inputs', () => {
    expect(() => resolveBetaVersion('3.1.7-beta.1', '2')).toThrow(
      'Stable baseline is required',
    );
    expect(() => resolveBetaVersion('3.1.7', '../2')).toThrow(
      'Invalid run number',
    );
  });
});
