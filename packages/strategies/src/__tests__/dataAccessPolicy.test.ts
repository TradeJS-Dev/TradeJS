/** @jest-environment node */

import path from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const strategiesRoot = path.join(__dirname, '..');
const repoRoot = path.join(strategiesRoot, '..', '..', '..');

const strategyNames = readdirSync(strategiesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((strategyName) =>
    existsSync(path.join(strategiesRoot, strategyName, 'core.ts')),
  )
  .sort();

const readStrategyCore = (strategyName: string) =>
  readFileSync(path.join(strategiesRoot, strategyName, 'core.ts'), 'utf8');

const readRepoFile = (...segments: string[]) =>
  readFileSync(path.join(repoRoot, ...segments), 'utf8');

const marketFullDataAllowlist = new Map<string, string>([
  [
    'MaStrategy',
    'figure generation still renders the full evaluated MA window',
  ],
  [
    'ReverseTrendLine',
    'trendline guardrails still evaluate a bounded timing window',
  ],
  ['TrendLine', 'trendline guardrails still evaluate a bounded timing window'],
]);

const destructuresFullDataFromMarket = (source: string) =>
  /const\s+\{[\s\S]*?\bfullData\b[\s\S]*?\}\s*=\s*await\s+strategyApi\.getMarketData\(/.test(
    source,
  );

const readsMarketFullData = (source: string) =>
  /\bmarket\.fullData\b/.test(source) || destructuresFullDataFromMarket(source);

describe('strategy data access policy', () => {
  it('keeps nextIndicators out of the public strategy API surface', () => {
    expect(readRepoFile('packages', 'types', 'src', 'strategy.ts')).not.toMatch(
      /\bnextIndicators\s*:/,
    );
    expect(
      readRepoFile(
        'packages',
        'core',
        'src',
        'utils',
        'strategyHelpers',
        'signalBuilders.ts',
      ),
    ).not.toContain('nextIndicators:');
  });

  it.each(strategyNames)(
    '%s does not advance indicators directly from core.ts',
    (strategyName) => {
      const source = readStrategyCore(strategyName);

      expect(source).not.toContain('strategyApi.nextIndicators(');
    },
  );

  it.each(strategyNames)(
    '%s keeps full market history usage explicit and allowlisted',
    (strategyName) => {
      const source = readStrategyCore(strategyName);
      const usesFullData = readsMarketFullData(source);
      const allowlistReason = marketFullDataAllowlist.get(strategyName);

      expect({
        strategyName,
        allowlistReason,
        usesFullData,
      }).toEqual({
        strategyName,
        allowlistReason,
        usesFullData: Boolean(allowlistReason),
      });
    },
  );
});
