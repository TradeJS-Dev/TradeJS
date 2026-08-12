import { summarizeCoreResearchWindow } from '../metrics';
import { buildCoreResearchHtml } from '../report';
import type { CoreResearchResult, CoreResearchVariantAnalysis } from '../types';
import {
  END,
  makeSpec,
  makeTrade,
  makeVariant,
  START,
} from '../__fixtures__/fixtures';

const makeAnalysis = (
  id: string,
  trades: ReturnType<typeof makeTrade>[],
): CoreResearchVariantAnalysis => {
  const full = summarizeCoreResearchWindow({
    trades,
    label: 'full',
    start: START,
    end: END,
  });
  return {
    variant: makeVariant({
      id,
      label: `<script>${id}</script>`,
      role: id === 'control' ? 'control' : 'candidate',
    }),
    files: [],
    duplicateRowsDropped: 0,
    setupIdentitySources: {
      'research.setupIdentity': trades.length,
      'strategy-context': 0,
      'signal-time-fallback': 0,
    },
    reconciliation: {
      status: 'not_requested',
      runId: null,
      manifestStatus: null,
      plannedTests: null,
      completedTests: null,
      redis: null,
      export: { trades: trades.length, wins: 0, losses: 0, pnl: 0 },
      delta: null,
      pnlTolerance: null,
      reasons: [],
    },
    full,
    terminal: [],
    folds: [],
    monthly: [],
    regimes: {},
    costStress: [],
    traceFunnel: { events: {}, skipCounts: {} },
    latestSignalTimeRegime: null,
    supplemental: { coldStart: {}, stress: {}, confirmation: null },
  };
};

describe('core research HTML report', () => {
  it('escapes experiment text and bounds chart complexity for large exports', () => {
    const trades = Array.from({ length: 10_000 }, (_, index) =>
      makeTrade({
        signalId: `signal-${index}`,
        setupIdentity: `setup-${index}`,
        exitTimestamp: START + index,
        netProfit: index % 7 === 0 ? -3 : 1,
      }),
    );
    const spec = makeSpec({
      researchId: 'report-safe',
      hypothesis: {
        family: 'report',
        claim: '<img src=x onerror=alert(1)>',
        mechanism: 'safe',
        target: 'ALL',
      },
    });
    const analysis = makeAnalysis('control', trades);
    const result = {
      schema: 'tradejs-core-research-result/v1',
      researchId: spec.researchId,
      stage: spec.stage,
      generatedAt: spec.createdAt,
      specSha256: 'a'.repeat(64),
      semantics: {
        cohortOrder: ['ALL', 'LONG', 'SHORT'],
        pnlPerTrade: 'cohort PnL / cohort completed positions',
        drawdown: {
          ALL: 'time-ordered aggregate portfolio realized drawdown',
          LONG: 'time-ordered LONG-only realized drawdown',
          SHORT: 'time-ordered SHORT-only realized drawdown',
        },
        regimeCausality:
          'signal-time payload.additionalIndicators.baseContext only',
      },
      variants: [analysis],
      comparisons: [],
      multipleTesting: { family: 'report', hypotheses: 1, method: 'Holm' },
      evidence: {
        screen: 'present',
        isolatedLong: 'missing',
        terminals: 'missing',
        folds: 'present',
        coldStart: 'missing',
        costStress: 'missing',
        delayStress: 'missing',
        fastNonFast: 'missing',
        runtimeParity: 'missing',
      },
      overfittingDiagnostics: {
        deflatedSharpe: {},
        probabilityOfBacktestOverfitting: {
          method: 'CSCV',
          combinations: 0,
          probability: null,
        },
      },
      artifactHashes: {},
    } as CoreResearchResult;

    const html = buildCoreResearchHtml({
      spec,
      result,
      tradesByVariant: new Map([['control', trades]]),
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;control&lt;/script&gt;');
    const pointLists = [
      ...html.matchAll(/<polyline[^>]+points="([^"]*)"/g),
    ].map((match) => match[1].trim().split(/\s+/));
    expect(pointLists.length).toBeGreaterThan(0);
    expect(
      Math.max(...pointLists.map((points) => points.length)),
    ).toBeLessThanOrEqual(1_200);
    expect(
      pointLists.every((points) => points.at(-1)?.startsWith('930.0,')),
    ).toBe(true);
    expect(html.length).toBeLessThan(500_000);
  });
});
