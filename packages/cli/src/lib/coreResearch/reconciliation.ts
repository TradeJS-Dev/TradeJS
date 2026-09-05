import {
  loadBacktestCheckpointResults,
  loadBacktestRunManifest,
} from '../backtest/checkpoint';
import type {
  CoreResearchMetrics,
  CoreResearchReconciliation,
  CoreResearchSpec,
  CoreResearchVariant,
} from './types';
import { sha256Json } from './io';
import { executionCostsFromModel } from '@tradejs/core/backtest';

const finite = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const reconcileCoreResearchVariant = async (params: {
  variant: CoreResearchVariant;
  exportMetrics: CoreResearchMetrics;
  spec: CoreResearchSpec;
  userName?: string;
}): Promise<CoreResearchReconciliation> => {
  const { variant, exportMetrics } = params;
  const exportSummary = {
    trades: exportMetrics.trades,
    wins: exportMetrics.wins,
    losses: exportMetrics.losses,
    pnl: exportMetrics.pnl,
  };
  if (!variant.runId) {
    return {
      status: 'not_requested',
      runId: null,
      manifestStatus: null,
      plannedTests: null,
      completedTests: null,
      redis: null,
      export: exportSummary,
      delta: null,
      pnlTolerance: null,
      reasons: ['variant.runId is not set'],
    };
  }
  const userName = params.userName ?? 'root';
  const [manifest, completed] = await Promise.all([
    loadBacktestRunManifest({ runId: variant.runId, userName }),
    loadBacktestCheckpointResults({ runId: variant.runId, userName }),
  ]);
  if (!manifest) {
    return {
      status: 'unavailable',
      runId: variant.runId,
      manifestStatus: null,
      plannedTests: null,
      completedTests: null,
      redis: null,
      export: exportSummary,
      delta: null,
      pnlTolerance: null,
      reasons: ['backtest manifest is unavailable'],
    };
  }
  const redis = completed.reduce(
    (summary, envelope) => {
      const stat = envelope.result.stat as typeof envelope.result.stat & {
        wins?: number;
        losses?: number;
        netProfit?: number;
      };
      summary.trades += finite(stat.orders);
      summary.wins += finite(stat.wins);
      summary.losses += finite(stat.losses);
      summary.pnl += finite(stat.netProfit ?? stat.profit);
      return summary;
    },
    { trades: 0, wins: 0, losses: 0, pnl: 0 },
  );
  const delta = {
    trades: exportSummary.trades - redis.trades,
    wins: exportSummary.wins - redis.wins,
    losses: exportSummary.losses - redis.losses,
    pnl: exportSummary.pnl - redis.pnl,
  };
  const pnlTolerance = completed.length * 0.005 + 1e-9;
  const reasons: string[] = [];
  for (const envelope of completed) {
    const model = envelope.result.executionCostModel;
    try {
      if (!model) throw new Error('missing');
      if (
        sha256Json(executionCostsFromModel(model)) !==
        sha256Json(params.spec.execution.costs)
      ) {
        reasons.push(
          'executed costs do not match the preregistered execution costs',
        );
        break;
      }
      if (
        model.fees.source !== 'config' ||
        model.slippage.source !== 'config' ||
        (model.funding.enabled && model.funding.source !== 'historical')
      ) {
        reasons.push('execution cost provenance is not explicit or historical');
        break;
      }
    } catch {
      reasons.push('executed execution cost model is missing or invalid');
      break;
    }
  }
  if (manifest.status !== 'completed') {
    reasons.push(`manifest status is ${manifest.status}`);
  }
  if (
    manifest.window.start !== params.spec.window.start ||
    manifest.window.end !== params.spec.window.end
  ) {
    reasons.push('manifest window does not match the preregistered window');
  }
  if (manifest.config !== variant.configName) {
    reasons.push(
      `manifest config ${manifest.config} does not match ${variant.configName}`,
    );
  }
  if (manifest.connectorName !== params.spec.execution.connector) {
    reasons.push(
      'manifest connector does not match the preregistered connector',
    );
  }
  if (String(manifest.interval) !== String(params.spec.execution.interval)) {
    reasons.push('manifest interval does not match the preregistered interval');
  }
  if (!manifest.flags.ai) {
    reasons.push('manifest did not enable raw AI dataset transport');
  }
  if (completed.length !== manifest.testSuite.length) {
    reasons.push(
      `checkpoint completion is ${completed.length}/${manifest.testSuite.length}`,
    );
  }
  const manifestSymbols = [
    ...new Set(manifest.testSuite.map((test) => test.symbol)),
  ];
  if (
    manifest.testSuite.length !== params.spec.universe.symbols.length ||
    sha256Json(manifestSymbols) !== params.spec.universe.sha256
  ) {
    reasons.push(
      'manifest test suite does not match the frozen ordered universe',
    );
  }
  if (
    manifest.testSuite.some(
      (test) => test.strategyName !== params.spec.strategy,
    )
  ) {
    reasons.push('manifest includes a different strategy');
  }
  const configIds = new Set(
    completed.map(
      (envelope) =>
        envelope.result.test.configId?.trim() || '<missing-config-id>',
    ),
  );
  if (configIds.size !== 1) {
    reasons.push(
      `variant run must be isolated to one configId, found ${configIds.size}`,
    );
  }
  const resolvedConfigHashes = new Set(
    completed.map((envelope) =>
      sha256Json(envelope.result.test.strategyConfig ?? {}),
    ),
  );
  if (
    resolvedConfigHashes.size !== 1 ||
    !resolvedConfigHashes.has(variant.configSha256)
  ) {
    reasons.push(
      'executed resolved strategy config does not match the preregistered config SHA',
    );
  }
  if (delta.trades !== 0 || delta.wins !== 0 || delta.losses !== 0) {
    reasons.push('export N/W/L does not match Redis result.stat');
  }
  if (Math.abs(delta.pnl) > pnlTolerance) {
    reasons.push(
      `export PnL delta ${delta.pnl} exceeds tolerance ${pnlTolerance}`,
    );
  }
  return {
    status: reasons.length ? 'mismatch' : 'match',
    runId: variant.runId,
    manifestStatus: manifest.status,
    plannedTests: manifest.testSuite.length,
    completedTests: completed.length,
    redis,
    export: exportSummary,
    delta,
    pnlTolerance,
    reasons,
  };
};
