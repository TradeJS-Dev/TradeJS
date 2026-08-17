import path from 'node:path';

export const SOURCE_REPOSITORY_ROOT_ENV =
  'TRADEJS_SOURCE_REPOSITORY_ROOT' as const;

export type ResearchRoots = {
  projectRoot: string;
  sourceRepositoryRoot: string;
};

type ResolveResearchRootsOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  sourceRepositoryRoot?: string;
};

const firstNonEmpty = (...values: Array<string | undefined>) =>
  values.map((value) => String(value || '').trim()).find(Boolean);

export const resolveResearchRoots = (
  options: ResolveResearchRootsOptions = {},
): ResearchRoots => {
  const cwd = path.resolve(options.cwd || process.cwd());
  const env = options.env || process.env;
  const projectRoot = path.resolve(
    firstNonEmpty(options.projectRoot, env.PROJECT_CWD, cwd) || cwd,
  );
  const sourceRepositoryRoot = path.resolve(
    firstNonEmpty(
      options.sourceRepositoryRoot,
      env[SOURCE_REPOSITORY_ROOT_ENV],
      cwd,
    ) || cwd,
  );

  return { projectRoot, sourceRepositoryRoot };
};
