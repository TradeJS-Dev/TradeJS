#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DIRECTIONS = ['LONG', 'SHORT'];

function assertMetric(metric, label) {
  for (const field of [
    'trades',
    'pnl',
    'pnlPerTrade',
    'profitFactor',
    'cadencePerDay',
  ]) {
    if (!Number.isFinite(metric?.[field])) {
      throw new Error(`${label}.${field} must be finite`);
    }
  }
}

function isUseful(metric, rule) {
  return (
    metric.trades >= rule.minimumTrades &&
    metric.cadencePerDay >= rule.minimumCadencePerDay &&
    metric.pnl > rule.minimumPnl &&
    metric.pnlPerTrade > rule.minimumPnlPerTrade &&
    metric.profitFactor > rule.minimumProfitFactor
  );
}

export function evaluateDirectionPolicyCheckpoint(input) {
  const rule = {
    minimumTrades: 0,
    minimumCadencePerDay: 0,
    minimumPnl: 0,
    minimumPnlPerTrade: 0,
    minimumProfitFactor: 1,
    maximumNegligibleApprovalShare: 0.05,
    ...input?.usefulSideRule,
  };

  assertMetric(input?.raw?.ALL, 'raw.ALL');
  for (const direction of DIRECTIONS) {
    assertMetric(input?.raw?.[direction], `raw.${direction}`);
  }

  const statuses = Object.fromEntries(
    DIRECTIONS.map((direction) => [
      direction,
      isUseful(input.raw[direction], rule) ? 'useful' : 'failed',
    ]),
  );

  const hidden = DIRECTIONS.find((direction) => {
    if (statuses[direction] !== 'useful' || !input.gateApproved) {
      return false;
    }
    const approved = input.gateApproved[direction];
    if (!approved || !Number.isFinite(approved.trades)) {
      throw new Error(`gateApproved.${direction}.trades must be finite`);
    }
    const share = input.raw[direction].trades
      ? approved.trades / input.raw[direction].trades
      : 0;
    return share <= rule.maximumNegligibleApprovalShare;
  });

  if (hidden) {
    return {
      schema: 'tradejs-direction-policy-decision/v1',
      trigger: 'profitable_side_hidden',
      required: true,
      usefulSideRule: rule,
      rawSideStatuses: statuses,
      retainedSide: hidden,
      proposedPolicy: `${hidden.toLowerCase()}_pass_through`,
    };
  }

  const usefulDirections = DIRECTIONS.filter(
    (direction) => statuses[direction] === 'useful',
  );
  if (usefulDirections.length === 1) {
    const retainedSide = usefulDirections[0];
    const failingSide = retainedSide === 'LONG' ? 'SHORT' : 'LONG';
    const contamination =
      input.raw[failingSide].pnl < 0 &&
      input.raw.ALL.pnl < input.raw[retainedSide].pnl;
    if (contamination) {
      return {
        schema: 'tradejs-direction-policy-decision/v1',
        trigger: 'losing_side_contamination',
        required: true,
        usefulSideRule: rule,
        rawSideStatuses: statuses,
        retainedSide,
        failingSide,
        proposedPolicy: `${retainedSide.toLowerCase()}_only`,
      };
    }
  }

  return {
    schema: 'tradejs-direction-policy-decision/v1',
    trigger: 'no_side_salvage',
    required: false,
    usefulSideRule: rule,
    rawSideStatuses: statuses,
    retainedSide: null,
    proposedPolicy: 'both',
  };
}

async function main() {
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex === -1 || !process.argv[inputIndex + 1]) {
    throw new Error(
      'Usage: direction-policy-checkpoint.mjs --input <input.json>',
    );
  }
  const input = JSON.parse(
    await readFile(process.argv[inputIndex + 1], 'utf8'),
  );
  process.stdout.write(
    `${JSON.stringify(evaluateDirectionPolicyCheckpoint(input), null, 2)}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
