export const RESEARCH_AGENT_MODEL = 'openai/gpt-5.4';
export const RESEARCH_AGENT_REASONING_EFFORT = 'medium';
export const RESEARCH_AGENT_BRANCH_PREFIX = 'codex/research';
export const RESEARCH_AGENT_DEFAULT_GITHUB_ORGANIZATION = 'TradeJS-Dev';

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
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  pullRequestTitle?: string;
  repository?: string;
  changedFiles?: string[];
  validation?: Record<string, 'pending' | 'passed' | 'failed' | 'skipped'>;
  model?: string;
  reasoningEffort?: string;
  summary?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

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

export const buildResearchAgentPrTitle = (strategy: string, runId: string) =>
  `Research agent: ${strategy} follow-up for ${runId}`;

export const getResearchAgentRepositoryName = (strategy: string) => {
  if (strategy === 'TrendLine' || strategy === 'ReverseTrendLine') {
    return 'TradeJS-Strategy-TrendLine';
  }

  return `TradeJS-Strategy-${strategy}`;
};

export const getResearchAgentRepository = (
  strategy: string,
  organization = RESEARCH_AGENT_DEFAULT_GITHUB_ORGANIZATION,
) => `${organization}/${getResearchAgentRepositoryName(strategy)}`;

export const getResearchAgentAllowedPathPrefixes = (strategy: string) => [
  `src/${strategy}/`,
];

export const parseGithubRepositoryFromRemote = (value: string) => {
  const trimmed = value.trim();
  const sshMatch = trimmed.match(/github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  const httpsMatch = trimmed.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }

  return null;
};

export const buildResearchAgentPrBody = (params: {
  strategy: string;
  runId: string;
  config: string;
  connector: string;
  timeframe: string;
  days: number;
  recent: number;
  changedFiles: string[];
  validation?: Record<string, 'pending' | 'passed' | 'failed' | 'skipped'>;
  summary?: string;
  aiTrainLocal?: {
    run?: {
      totalRows?: number;
      approvedRows?: number;
      minQuality?: number;
    };
    outcome?: {
      approvalRate?: number;
      precisionApproved?: number;
      recallWinners?: number;
      avgProfitApproved?: number;
      avgProfitApprovedPerMonth?: number;
      expectancyDelta?: number;
    };
  } | null;
}) => {
  const validationSummary = Object.entries(params.validation || {})
    .map(([key, value]) => `- \`${key}\`: ${value}`)
    .join('\n');
  const aiRun = params.aiTrainLocal?.run;
  const aiOutcome = params.aiTrainLocal?.outcome;

  const lines = [
    '## Why',
    `Automated research follow-up for \`${params.strategy}\` from run \`${params.runId}\`.`,
    `Research config: \`${params.config}\`, connector \`${params.connector}\`, timeframe \`${params.timeframe}\`, window \`${params.days}d\`, recent rows \`${params.recent}\`.`,
  ];

  if (params.summary) {
    lines.push(params.summary);
  }

  if (aiRun || aiOutcome) {
    lines.push('');
    lines.push('### AI train snapshot');
    if (aiRun) {
      lines.push(
        `- Rows: \`${aiRun.totalRows ?? 0}\`, approved: \`${aiRun.approvedRows ?? 0}\`, minQuality: \`${aiRun.minQuality ?? 'n/a'}\``,
      );
    }
    if (aiOutcome) {
      lines.push(
        `- approvalRate=\`${aiOutcome.approvalRate ?? 0}\`, precisionApproved=\`${aiOutcome.precisionApproved ?? 0}\`, recallWinners=\`${aiOutcome.recallWinners ?? 0}\``,
      );
      lines.push(
        `- avgProfitApproved=\`${aiOutcome.avgProfitApproved ?? 0}\`, avgProfitApprovedPerMonth=\`${aiOutcome.avgProfitApprovedPerMonth ?? 0}\`, expectancyDelta=\`${aiOutcome.expectancyDelta ?? 0}\``,
      );
    }
  }

  lines.push('');
  lines.push('## What changed');
  for (const file of params.changedFiles) {
    lines.push(`- \`${file}\``);
  }

  lines.push('');
  lines.push('## Validation');
  lines.push(validationSummary || '- Validation did not run');

  lines.push('');
  lines.push('## Notes');
  lines.push('- Created automatically by the TradeJS research agent.');
  lines.push('- Base branch: `main`.');

  return lines.join('\n');
};

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
