import { assertNoResearchFileConsumers } from '../lib/strategyRelease/researchFileConsumers';

describe('research file consumers across Docker Desktop mounts', () => {
  const file = '/project/data/trades.jsonl';
  const vm =
    '/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine';
  const runner =
    (overrides: Record<string, string> = {}) =>
    async (command: string, args: string[]) => {
      const key = command === 'docker' ? `${command} ${args[0]}` : command;
      const outputs: Record<string, string> = {
        lsof: `p100\nccom.apple.Virtualization.Virtua\nf12\nn${file}\n`,
        ps: vm,
        'docker context': JSON.stringify([
          { Endpoints: { docker: { Host: 'unix:///docker.sock' } } },
        ]),
        'docker ps': 'container-one\n',
        'docker inspect': JSON.stringify([
          {
            Id: 'container-one',
            Mounts: [
              {
                Type: 'bind',
                Source: '/project/data',
                Destination: '/app/data',
              },
            ],
          },
        ]),
        'docker exec': '[]',
        ...overrides,
      };
      if (!(key in outputs)) throw new Error(`Unexpected command ${key}`);
      if (key === 'docker exec') {
        expect(JSON.parse(args.at(-1)!)).toEqual(['/app/data/trades.jsonl']);
      }
      return { stdout: outputs[key] };
    };

  it('accepts virtiofs cached host handles only after checking every bound guest consumer', async () => {
    await expect(
      assertNoResearchFileConsumers([file], runner()),
    ).resolves.toBeUndefined();
  });

  it.each<Record<string, string>>([
    { lsof: `p100\ncnode\nn${file}\n` },
    { ps: '/unrecognized/vm' },
    {
      'docker context': JSON.stringify([
        { Endpoints: { docker: { Host: 'ssh://remote' } } },
      ]),
    },
    { 'docker ps': '' },
    { 'docker inspect': JSON.stringify([{ Id: 'container-one', Mounts: [] }]) },
    { 'docker exec': '["/app/data/trades.jsonl"]' },
    { 'docker exec': '{}' },
  ])('protects open or unverifiable guest files (%j)', async (overrides) => {
    await expect(
      assertNoResearchFileConsumers([file], runner(overrides)),
    ).rejects.toThrow();
  });

  it('does not inspect Docker when no process has a file open', async () => {
    await expect(
      assertNoResearchFileConsumers([file], async (command) => {
        expect(command).toBe('lsof');
        throw Object.assign(new Error('no open files'), { code: 1 });
      }),
    ).resolves.toBeUndefined();
  });

  it('does not ignore missing inspection tools', async () => {
    await expect(
      assertNoResearchFileConsumers([file], async () => {
        throw Object.assign(new Error('not installed'), { code: 'ENOENT' });
      }),
    ).rejects.toThrow('not installed');
  });

  it('ignores unrelated active files when scanning a large closed-study directory', async () => {
    const files = Array.from(
      { length: 1001 },
      (_, index) => `/project/data/closed/${index}.jsonl`,
    );
    await expect(
      assertNoResearchFileConsumers(files, async () => ({
        stdout: 'p50\ncnode\nn/project/data/closed/current-study.jsonl\n',
      })),
    ).resolves.toBeUndefined();
    await expect(
      assertNoResearchFileConsumers(files, async () => ({
        stdout: 'p50\ncnode\nn/project/data/closed/1000.jsonl\n',
      })),
    ).rejects.toThrow('open files');
  });
});
