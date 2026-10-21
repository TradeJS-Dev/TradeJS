import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const runCommand: RunCommand = (command, args) =>
  execFileAsync(command, args, { maxBuffer: 32 * 1024 * 1024 });
type RunCommand = (
  command: string,
  args: string[],
) => Promise<{ stdout: string }>;

const GUEST_FILE_CHECK = `
import os, sys, json
if os.geteuid() != 0:
    raise RuntimeError('Cannot inspect every container process')
wanted = set(json.loads(sys.argv[1]))
opened = set()
for pid in os.listdir('/proc'):
    if not pid.isdigit():
        continue
    for kind in ('fd', 'map_files'):
        directory = '/proc/' + pid + '/' + kind
        try:
            names = os.listdir(directory)
        except FileNotFoundError:
            continue
        for name in names:
            try:
                target = os.readlink(directory + '/' + name)
            except FileNotFoundError:
                continue
            if target in wanted:
                opened.add(target)
print(json.dumps(sorted(opened)))
`;

/** macOS virtiofs caches host handles even after the container closed them. */
export const assertNoResearchFileConsumers = async (
  files: string[],
  run: RunCommand = runCommand,
) => {
  const virtualPids = new Set<string>();
  const wanted = new Set(files.map((file) => path.resolve(file)));
  let commonRoot = files.length ? path.dirname(files[0]) : '';
  while (
    commonRoot &&
    files.some((file) => {
      const relative = path.relative(commonRoot, file);
      return (
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      );
    })
  )
    commonRoot = path.dirname(commonRoot);
  const selectors: string[][] = [];
  if (files.length > 1000 && commonRoot !== path.parse(commonRoot).root) {
    selectors.push(['+D', commonRoot]);
  } else {
    for (let offset = 0; offset < files.length; offset += 100)
      selectors.push(['--', ...files.slice(offset, offset + 100)]);
  }
  for (const selector of selectors) {
    let output: string;
    try {
      output = (await run('lsof', ['-F', 'pcn', ...selector])).stdout;
    } catch (error) {
      if ((error as { code?: number }).code === 1) continue;
      throw error;
    }
    let pid = '';
    let virtual = false;
    for (const line of output.split('\n')) {
      if (line.startsWith('p')) {
        pid = line.slice(1);
        virtual = false;
      }
      if (line.startsWith('c'))
        virtual = line.startsWith('ccom.apple.Virtualization.');
      if (line.startsWith('n')) {
        if (!wanted.has(path.resolve(line.slice(1)))) continue;
        if (!virtual || !/^\d+$/.test(pid))
          throw new Error(
            `Research cleanup found open files: ${line.slice(1)}`,
          );
        virtualPids.add(pid);
      }
    }
  }
  if (!virtualPids.size) return;
  for (const pid of virtualPids) {
    const comm = (await run('ps', ['-p', pid, '-o', 'comm='])).stdout.trim();
    if (
      comm !==
      '/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine'
    ) {
      throw new Error('Unrecognized virtual file consumer');
    }
  }
  const contexts = JSON.parse(
    (await run('docker', ['context', 'inspect'])).stdout,
  ) as Array<{ Endpoints: { docker: { Host: string } } }>;
  if (
    contexts.length !== 1 ||
    !contexts[0].Endpoints.docker.Host.startsWith('unix://')
  ) {
    throw new Error('Research file inspection requires a local Docker socket');
  }
  const ids = (await run('docker', ['ps', '-q'])).stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length)
    throw new Error('Cannot resolve virtual research file handles');
  const containers = JSON.parse(
    (await run('docker', ['inspect', ...ids])).stdout,
  ) as Array<{
    Id: string;
    Mounts: Array<{ Type: string; Source: string; Destination: string }>;
  }>;
  const covered = new Set<string>();
  for (const container of containers) {
    const guestFiles = new Set<string>();
    for (const mount of container.Mounts) {
      if (mount.Type !== 'bind') continue;
      for (const file of files) {
        const relative = path.relative(mount.Source, file);
        if (
          relative === '' ||
          (!relative.startsWith(`..${path.sep}`) &&
            relative !== '..' &&
            !path.isAbsolute(relative))
        ) {
          guestFiles.add(path.posix.join(mount.Destination, relative));
          covered.add(file);
        }
      }
    }
    if (!guestFiles.size) continue;
    // A missing Python, unreadable /proc or container error fails closed.
    const paths = [...guestFiles];
    for (let offset = 0; offset < paths.length; offset += 250) {
      const opened: unknown = JSON.parse(
        (
          await run('docker', [
            'exec',
            container.Id,
            'python',
            '-c',
            GUEST_FILE_CHECK,
            JSON.stringify(paths.slice(offset, offset + 250)),
          ])
        ).stdout,
      );
      if (!Array.isArray(opened) || opened.length)
        throw new Error('Research cleanup found open files in a container');
    }
  }
  if (covered.size !== files.length)
    throw new Error('Unresolved virtual research file handles');
};
