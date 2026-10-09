import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Calendar-weighted diagnostics of recorded closed-trade equity, not a new gate
// or a mark-to-market account curve. Zero PnL is the initial high-water mark.
export const summarizeEquityStability = (points) => {
  if (!Array.isArray(points) || points.length < 2)
    throw new Error('At least two recorded equity points required');
  let peak = 0;
  let peakTimestamp = points[0][0];
  let underwaterStart = null;
  let underwaterMs = 0;
  let squaredDrawdownMs = 0;
  let maxRecoveryMs = 0;
  let maxUnderwaterMs = 0;
  let maxDrawdown = 0;
  let previousTimestamp = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const [timestamp, pnl] = points[i];
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(pnl) ||
      timestamp < previousTimestamp
    )
      throw new Error('Equity must be finite and chronologically ordered');
    previousTimestamp = timestamp;
    if (pnl >= peak) {
      if (underwaterStart !== null) {
        maxRecoveryMs = Math.max(maxRecoveryMs, timestamp - peakTimestamp);
        maxUnderwaterMs = Math.max(
          maxUnderwaterMs,
          timestamp - underwaterStart,
        );
      }
      peak = pnl;
      peakTimestamp = timestamp;
      underwaterStart = null;
    } else if (underwaterStart === null) {
      underwaterStart = timestamp;
    }
    const dd = peak - pnl;
    maxDrawdown = Math.max(maxDrawdown, dd);
    const next = points[i + 1];
    if (next) {
      if (!Number.isFinite(next[0]) || next[0] < timestamp)
        throw new Error('Equity must be finite and chronologically ordered');
      const duration = next[0] - timestamp;
      if (dd > 0) underwaterMs += duration;
      squaredDrawdownMs += dd * dd * duration;
    }
  }
  const end = points.at(-1)[0];
  if (underwaterStart !== null) {
    maxRecoveryMs = Math.max(maxRecoveryMs, end - peakTimestamp);
    maxUnderwaterMs = Math.max(maxUnderwaterMs, end - underwaterStart);
  }
  const span = end - points[0][0];
  return {
    calendarDays: span / 86400000,
    underwaterDays: underwaterMs / 86400000,
    underwaterShare: span > 0 ? underwaterMs / span : null,
    maxRecoveryDays: maxRecoveryMs / 86400000,
    maxUnderwaterDays: maxUnderwaterMs / 86400000,
    recoveryRightCensored: underwaterStart !== null,
    calendarUlcerIndex: span > 0 ? Math.sqrt(squaredDrawdownMs / span) : null,
    maxDrawdown,
    basis:
      'recorded closed-trade equity held constant between observations; final unrecovered episode right-censored',
  };
};

export const buildEquityStabilityReport = (report) => {
  const policies = [report.baseline, ...report.variants];
  return {
    schema: 'tradejs-equity-stability/v1',
    generatedAt: new Date().toISOString(),
    metricBasis: 'completed-trade-calendar',
    selectionRole:
      'full-period retrospective diagnostics only, not held-out tuning',
    policies: policies.map((policy) => {
      if (!policy.realized?.equity)
        throw new Error('Complete realized equity required');
      return {
        name: policy.name ?? 'baseline',
        ...summarizeEquityStability(policy.realized.equity),
      };
    }),
  };
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  if (!process.argv.includes('--input') || !process.argv.includes('--output'))
    throw new Error('Use --input <ablation.json> --output <new.json>');
  const input = arg('--input');
  const bytes = fs.readFileSync(input);
  const result = {
    ...buildEquityStabilityReport(JSON.parse(bytes)),
    input: {
      path: input,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
  fs.writeFileSync(arg('--output'), JSON.stringify(result, null, 2), {
    flag: 'wx',
  });
  console.log(JSON.stringify(result));
}
