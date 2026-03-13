import { spawn } from 'child_process';

const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

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
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      yarnCommand,
      ['workspace', '@tradejs/cli', command, ...args],
      {
        cwd: projectCwd,
        stdio: 'inherit',
        env: {
          ...process.env,
          ...env,
          PROJECT_CWD: projectCwd,
        },
      },
    );

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
