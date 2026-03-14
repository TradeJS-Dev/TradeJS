import path from 'path';
import { spawn } from 'child_process';

export const runTradejsCli = async ({
  command,
  args,
  projectCwd,
  env = {},
  errorMessage,
}: {
  command: string;
  args: string[];
  projectCwd: string;
  env?: NodeJS.ProcessEnv;
  errorMessage: string;
}): Promise<void> => {
  const cliBin = path.resolve(
    projectCwd,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tradejs.cmd' : 'tradejs',
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cliBin, [command, ...args], {
      cwd: projectCwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
        PROJECT_CWD: projectCwd,
      },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${errorMessage} ${code ?? -1}`));
    });
  });
};
