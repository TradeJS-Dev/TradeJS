import path from 'node:path';

export const RESEARCH_AGENT_MODEL = 'openai/gpt-5.4';
export const RESEARCH_AGENT_REASONING_EFFORT = 'medium';
export const RESEARCH_AGENT_BRANCH_PREFIX = 'codex/research';

export type ResearchAgentStatus =
  | 'pending'
  | 'running'
  | 'no_changes'
  | 'completed'
  | 'failed';

export interface ResearchAgentRunRecord {
  status: ResearchAgentStatus;
  strategy: string;
  runId: string;
  branchName?: string;
  commitHash?: string;
  commitMessage?: string;
  changedFiles?: string[];
  validation?: Record<string, 'pending' | 'passed' | 'failed' | 'skipped'>;
  model?: string;
  reasoningEffort?: string;
  summary?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export const toUpperSnakeCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

const RESEARCH_NOTE_FILE_OVERRIDES: Record<string, string> = {
  TrendLine: 'AI_TRENDLINE_REPLAY_NOTES.md',
  ReverseTrendLine: 'AI_REVERSE_TRENDLINE_REPLAY_NOTES.md',
  AdaptiveMomentumRibbon: 'AI_ADAPTIVE_MOMENTUM_RIBBON_REPLAY_NOTES.md',
  VolumeDivergence: 'AI_VOLUME_DIVERGENCE_REPLAY_NOTES.md',
};

export const buildResearchAgentBranchName = (
  strategy: string,
  runId: string,
) => {
  const normalizedStrategy = strategy
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const normalizedRunId = runId
    .trim()
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return `${RESEARCH_AGENT_BRANCH_PREFIX}/${normalizedStrategy}-${normalizedRunId}`;
};

export const buildResearchAgentCommitMessage = (
  strategy: string,
  runId: string,
) => `Research agent: ${strategy} follow-up for ${runId}`;

export const getResearchAgentNotePath = (strategy: string) =>
  path.join(
    'notes',
    RESEARCH_NOTE_FILE_OVERRIDES[strategy] ||
      `AI_${toUpperSnakeCase(strategy)}_REPLAY_NOTES.md`,
  );

export const getResearchAgentAllowedPathPrefixes = (strategy: string) => [
  `packages/strategies/src/${strategy}/`,
  getResearchAgentNotePath(strategy),
];

export const normalizeDiffOutput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const fenced = trimmed.match(/```(?:diff)?\s*([\s\S]*?)```/i);
  const content = fenced?.[1]?.trim() || trimmed;
  return content.trim();
};

export const parseChangedFilesFromDiff = (diffText: string): string[] => {
  const files = new Set<string>();
  const lines = diffText.split('\n');

  for (const line of lines) {
    if (!line.startsWith('+++ ')) {
      continue;
    }

    const filePath = line.slice(4).trim();
    if (!filePath || filePath === '/dev/null') {
      continue;
    }

    const normalized = filePath.startsWith('b/') ? filePath.slice(2) : filePath;
    if (normalized) {
      files.add(normalized);
    }
  }

  return [...files];
};

export const assertDiffAllowed = (
  diffText: string,
  allowedPrefixes: string[],
): string[] => {
  if (!diffText || diffText === 'NO_CHANGES') {
    return [];
  }

  if (/\n\+\+\+\s+\/dev\/null\b/.test(`\n${diffText}`)) {
    throw new Error('Research agent diff must not delete files');
  }

  const changedFiles = parseChangedFilesFromDiff(diffText);
  if (!changedFiles.length) {
    throw new Error('Research agent diff did not contain any changed files');
  }

  for (const filePath of changedFiles) {
    const allowed = allowedPrefixes.some((prefix) =>
      prefix.endsWith('/')
        ? filePath.startsWith(prefix)
        : filePath === prefix || filePath.startsWith(`${prefix}/`),
    );
    if (!allowed) {
      throw new Error(`Research agent changed disallowed path: ${filePath}`);
    }
  }

  return changedFiles;
};
