import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isMcpRecord, redactMcpJobLog } from '@tradejs/node/mcp';
import type { StrategyComparison } from './strategyDiagnosticContracts';
import { listMcpArtifacts, resolveMcpArtifact } from './mcp/artifacts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  isMcpRecord(value) ? value : {};
const records = (value: unknown): RecordValue[] =>
  Array.isArray(value) ? value.filter(isMcpRecord) : [];
const text = (value: unknown) =>
  typeof value === 'string' ? redactMcpJobLog(value.slice(0, 500)) : undefined;
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const timestamp = (value: unknown) => {
  const time = number(value);
  return time !== undefined && time >= 0 && time < 8.64e15 ? time : undefined;
};

const caseKey = (row: RecordValue) =>
  JSON.stringify([
    row.strategy ?? row.inferredStrategy,
    row.symbol,
    row.direction,
    row.timestamp,
    row.signalId ?? row.orderId,
  ]);

function trade(value: RecordValue) {
  return {
    time: timestamp(value.timestamp),
    price: number(value.price),
    exitPrice: number(value.exitPrice),
    pnl: number(value.pnl),
    quantity: number(value.qty),
    signalId: text(value.signalId),
    orderId: text(value.orderId),
  };
}

const categories = ['matched', 'runtimeOnly', 'backtestOnly'] as const;

export function summarizeStrategyComparison(
  payload: unknown,
): StrategyComparison {
  const root = record(payload);
  const deployment = record(root.deployment);
  const replay = record(root.replay);
  const comparison = record(replay.runtimeComparison);
  const drilldown = record(comparison.mismatchDrilldown);
  const runtimeOrders = new Map(
    records(record(root.runtime).trades).flatMap(({ trade }) => {
      const row = record(trade);
      return typeof row.orderId === 'string' && typeof row.symbol === 'string'
        ? [[JSON.stringify([row.symbol, row.orderId]), row] as const]
        : [];
    }),
  );

  const strategies = Object.entries(record(comparison.byStrategy)).map(
    ([name, value]) => {
      const row = record(value);
      return {
        name,
        matched: number(row.matched) ?? 0,
        runtimeOnly: number(row.runtimeOnly) ?? 0,
        backtestOnly: number(row.backtestOnly) ?? 0,
      };
    },
  );
  const cases = categories
    .flatMap((category) => {
      const details = new Map(
        records(drilldown[category]).map((item) => [
          caseKey(record(item.entry)),
          item,
        ]),
      );
      return records(comparison[category]).map((row, index) => {
        const detail = details.get(caseKey(row)) ?? {};
        const signal = record(detail.runtimeSignal);
        const evaluation = record(detail.runtimeEvaluation);
        const signalArtifact = record(detail.runtimeSignalArtifact);
        const evaluationArtifact = record(detail.runtimeEvaluationArtifact);
        const matched = category === 'matched';
        const savedTrade =
          runtimeOrders.get(JSON.stringify([row.symbol, row.orderId])) ?? {};
        const runtime = matched
          ? trade({
              timestamp: row.runtimeTimestamp,
              price: row.runtimePrice,
              exitPrice: row.runtimeExitPrice,
              pnl: row.realizedPnl,
              orderId: row.orderId,
              qty: row.runtimeQty ?? savedTrade.qty,
              signalId: row.runtimeSignalId ?? savedTrade.signalId,
            })
          : category === 'runtimeOnly'
            ? trade(row)
            : signal.signalId
              ? trade({ ...signal, price: record(signalArtifact.prices).entry })
              : null;
        const replayTrade = matched
          ? trade({
              timestamp: row.timestamp,
              price: row.backtestPrice,
              exitPrice: row.backtestExitPrice,
              pnl: row.expectedPnl,
              qty: row.backtestQty,
              signalId: row.signalId,
            })
          : category === 'backtestOnly'
            ? trade(row)
            : null;
        return {
          id: createHash('sha256')
            .update(JSON.stringify([category, caseKey(row), index]))
            .digest('hex')
            .slice(0, 24),
          category,
          strategy:
            text(
              row.strategy ??
                row.inferredStrategy ??
                row.runtimeInferredStrategy,
            ) ?? 'Unassigned',
          symbol: text(row.symbol) ?? 'Unknown',
          direction: text(row.direction),
          interval: text(
            signalArtifact.interval ??
              evaluationArtifact.interval ??
              row.interval ??
              savedTrade.interval,
          ),
          universe:
            (signalArtifact.universe ??
              evaluationArtifact.universe ??
              row.universe ??
              savedTrade.universe) === 'tradfi'
              ? ('tradfi' as const)
              : ('crypto' as const),
          time: timestamp(row.timestamp ?? row.runtimeTimestamp) ?? 0,
          runtime,
          replay: replayTrade,
          classification: text(detail.classification),
          reason: text(detail.reason),
          decision: text(
            signal.orderSkipReason ??
              evaluation.orderSkipReason ??
              evaluation.reason,
          ),
          evaluationId: text(evaluation.evaluationId),
        };
      });
    })
    .sort((a, b) => b.time - a.time);
  return {
    deployment: text(deployment.label ?? deployment.id),
    provider: text(deployment.provider) ?? 'bybit',
    strategies,
    cases,
  };
}

type ReportList = Awaited<ReturnType<typeof listMcpArtifacts>>;
let cached:
  | { user: string; until: number; result: Promise<ReportList> }
  | undefined;
export function listStrategyDiagnostics(user: string) {
  if (cached?.user === user && cached.until > Date.now()) return cached.result;
  const result = listMcpArtifacts(user, {
    kind: 'runtime-feedback-replay',
    limit: 100,
  });
  const entry = { user, until: Date.now() + 60_000, result };
  cached = entry;
  void result.catch(() => {
    if (cached === entry) cached = undefined;
  });
  return result;
}

export async function readStrategyDiagnostic(user: string, id: string) {
  await listStrategyDiagnostics(user);
  const artifact = await resolveMcpArtifact(user, id);
  if (artifact.kind !== 'runtime-feedback-replay')
    throw new Error('Report is unavailable.');
  return summarizeStrategyComparison(
    JSON.parse(await readFile(artifact.payloadPath, 'utf8')),
  );
}
