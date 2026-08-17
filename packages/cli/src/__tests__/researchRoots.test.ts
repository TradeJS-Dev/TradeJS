import path from 'node:path';
import {
  resolveResearchRoots,
  SOURCE_REPOSITORY_ROOT_ENV,
} from '../lib/researchRoots';

describe('research roots', () => {
  it('uses cwd for both roles by default', () => {
    expect(
      resolveResearchRoots({
        cwd: '/workspace/tradejs-project',
        env: {},
      }),
    ).toEqual({
      projectRoot: path.resolve('/workspace/tradejs-project'),
      sourceRepositoryRoot: path.resolve('/workspace/tradejs-project'),
    });
  });

  it('separates project artifacts from the source repository through env', () => {
    expect(
      resolveResearchRoots({
        cwd: '/workspace/tradejs',
        env: {
          PROJECT_CWD: '/workspace/tradejs-project',
          [SOURCE_REPOSITORY_ROOT_ENV]: '/workspace/strategy-trend-line',
        },
      }),
    ).toEqual({
      projectRoot: path.resolve('/workspace/tradejs-project'),
      sourceRepositoryRoot: path.resolve('/workspace/strategy-trend-line'),
    });
  });

  it('lets explicit roots override inherited process configuration', () => {
    expect(
      resolveResearchRoots({
        cwd: '/workspace/current',
        env: {
          PROJECT_CWD: '/workspace/env-project',
          [SOURCE_REPOSITORY_ROOT_ENV]: '/workspace/env-source',
        },
        projectRoot: '/workspace/explicit-project',
        sourceRepositoryRoot: '/workspace/explicit-source',
      }),
    ).toEqual({
      projectRoot: path.resolve('/workspace/explicit-project'),
      sourceRepositoryRoot: path.resolve('/workspace/explicit-source'),
    });
  });
});
