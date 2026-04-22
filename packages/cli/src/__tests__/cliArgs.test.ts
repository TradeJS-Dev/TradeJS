import { normalizeCliArgv } from '../lib/cliArgs';

describe('normalizeCliArgv', () => {
  it('rewrites legacy short flags to long flags', () => {
    expect(
      normalizeCliArgv(
        ['node', 'script', '-P', '1', '-S=123', '-E', '456', '-T', '10'],
        {
          '-E': '--endTime',
          '-P': '--progressStep',
          '-S': '--startTime',
          '-T': '--top',
        },
      ),
    ).toEqual([
      'node',
      'script',
      '--progressStep',
      '1',
      '--startTime=123',
      '--endTime',
      '456',
      '--top',
      '10',
    ]);
  });

  it('keeps unrelated args unchanged', () => {
    expect(
      normalizeCliArgv(['node', 'script', '--ai', '-d', '3'], {
        '-P': '--progressStep',
      }),
    ).toEqual(['node', 'script', '--ai', '-d', '3']);
  });
});
