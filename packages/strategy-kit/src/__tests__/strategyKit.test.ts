/** @jest-environment node */

import type { Position } from '@tradejs/types';
import { isDirectionAligned, isPressureAligned } from '../context';
import {
  buildEntryEvidenceAnnotation,
  buildEntryStopTargetFigures,
  formatFigureMetric,
  formatFigureRatioAsPercent,
} from '../figures';
import {
  clampNumber,
  isFiniteNumber,
  normalizePositiveNumber,
  toFiniteNumberOrNull,
} from '../numbers';
import { isOpenPosition } from '../positions';
import {
  buildAtrFallbackStop,
  buildContextRiskOrder,
  buildStructureRiskPlan,
  buildTradeEconomics,
  resolveAtrBuffer,
} from '../risk';

describe('strategy kit number helpers', () => {
  it('normalizes finite values without accepting non-finite numbers', () => {
    expect(isFiniteNumber(1)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(toFiniteNumberOrNull('12.5')).toBe(12.5);
    expect(toFiniteNumberOrNull(undefined)).toBeNull();
    expect(clampNumber(12, 0, 10)).toBe(10);
    expect(normalizePositiveNumber(-1, 3)).toBe(3);
  });
});

describe('strategy kit figure helpers', () => {
  it('preserves metric and ratio formatting', () => {
    expect(formatFigureMetric(1.234, 2, ' USD')).toBe('1.23 USD');
    expect(formatFigureMetric(null)).toBe('n/a');
    expect(formatFigureRatioAsPercent(0.551, 1)).toBe('55.1%');
  });

  it('limits entry evidence and preserves directional colors', () => {
    const annotation = buildEntryEvidenceAnnotation({
      idPrefix: 'test',
      kind: 'entry_evidence',
      direction: 'SHORT',
      entryTimestamp: 100,
      entryPrice: 20,
      title: 'Evidence',
      items: ['one', '', 'two', 'three', 'four', 'five', 'six', 'seven'],
    });

    expect(annotation).toMatchObject({
      id: 'test-evidence-100',
      kind: 'entry_evidence',
      color: '#f87171',
      point: { timestamp: 100, value: 20 },
    });
    expect(annotation.items).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
    ]);
  });

  it('builds entry, stop, target, and optional reference figures', () => {
    const figures = buildEntryStopTargetFigures({
      idPrefix: 'test',
      direction: 'LONG',
      entryTimestamp: 200,
      entryPrice: 100,
      stopLossPrice: 90,
      takeProfitPrice: 120,
      referenceTimestamp: 150,
      referencePrice: 95,
      referenceKind: 'level',
    });

    expect(figures.lines).toHaveLength(3);
    expect(figures.lines?.[2]).toMatchObject({
      id: 'test-level-200',
      kind: 'test_level',
      points: [
        { timestamp: 150, value: 95 },
        { timestamp: 200, value: 95 },
      ],
    });
    expect(figures.points?.[0]).toMatchObject({
      id: 'test-entry-200',
      points: [{ timestamp: 200, value: 100 }],
    });
  });
});

describe('strategy kit context and position helpers', () => {
  it('evaluates direction and pressure without inventing missing pressure', () => {
    expect(
      isDirectionAligned({
        direction: 'LONG',
        bullValue: 'up',
        bearValue: 'down',
        value: 'up',
      }),
    ).toBe(true);
    expect(isPressureAligned({ direction: 'SHORT', buyPressurePct: 0.4 })).toBe(
      true,
    );
    expect(
      isPressureAligned({ direction: 'LONG', buyPressurePct: null }),
    ).toBeNull();
  });

  it('recognizes only finite positive open positions', () => {
    expect(
      isOpenPosition({
        direction: 'LONG',
        price: 100,
        qty: 1,
      } as Position),
    ).toBe(true);
    expect(
      isOpenPosition({
        direction: 'SHORT',
        price: 100,
        qty: 0,
      } as Position),
    ).toBe(false);
  });
});

describe('strategy kit risk helpers', () => {
  it('uses the larger ATR or percentage buffer for fallback stops', () => {
    expect(
      resolveAtrBuffer({
        atr: 2,
        currentPrice: 100,
        atrMult: 2,
        bufferPct: 5,
      }),
    ).toBe(5);
    expect(
      buildAtrFallbackStop({
        direction: 'SHORT',
        atr: 2,
        currentPrice: 100,
        atrMult: 2,
        bufferPct: 5,
      }),
    ).toBe(105);
  });

  it('preserves invalid stop, quantity, ratio, and successful plan outcomes', () => {
    expect(
      buildContextRiskOrder({
        currentPrice: 100,
        direction: 'LONG',
        stopLossPrice: 110,
        targetR: 2,
        maxLossValue: 10,
        feeRate: 0,
        minRiskRatio: 1,
      }),
    ).toEqual({ skipCode: 'INVALID_STOP' });

    expect(
      buildContextRiskOrder({
        currentPrice: 100,
        direction: 'LONG',
        stopLossPrice: 90,
        targetR: 2,
        maxLossValue: 0,
        feeRate: 0,
        minRiskRatio: 1,
      }),
    ).toEqual({ skipCode: 'INVALID_QTY' });

    expect(
      buildContextRiskOrder({
        currentPrice: 100,
        direction: 'LONG',
        stopLossPrice: 90,
        targetR: 1,
        maxLossValue: 10,
        feeRate: 0,
        minRiskRatio: 1,
      }).skipCode,
    ).toBe('RISK_RATIO:1');

    expect(
      buildContextRiskOrder({
        currentPrice: 100,
        direction: 'LONG',
        stopLossPrice: 90,
        targetR: 2,
        maxLossValue: 10,
        feeRate: 0,
        minRiskRatio: 1,
      }).plan,
    ).toMatchObject({
      stopLossPrice: 90,
      takeProfitPrice: 120,
      riskRatio: 2,
    });
  });

  it('treats feeRate as a decimal rate and includes both trade legs', () => {
    const economics = buildTradeEconomics({
      entryPrice: 100,
      stopLossPrice: 90,
      takeProfitPrice: 120,
      feeRate: 0.001,
    });

    expect(economics.roundTripEntryStopCostPerUnit).toBeCloseTo(0.19);
    expect(economics.roundTripEntryTargetCostPerUnit).toBeCloseTo(0.22);
    expect(economics.lossPerUnit).toBeCloseTo(10.19);
    expect(economics.rewardPerUnit).toBeCloseTo(19.78);
    expect(economics.netRiskRatio).toBeCloseTo(19.78 / 10.19);
  });

  it('sizes quantity to the net stop loss including slippage', () => {
    const plan = buildStructureRiskPlan({
      currentPrice: 100,
      direction: 'LONG',
      stopLossPrice: 90,
      targetR: 2,
      maxLossValue: 10,
      feeRate: 0.001,
      slippageBps: 10,
    });

    expect(plan.takeProfitPrice).toBe(120);
    expect(plan.grossRiskRatio).toBe(2);
    expect(plan.riskRatio).toBeLessThan(2);
    expect(plan.qty * plan.lossPerUnit).toBeCloseTo(10);
  });

  it('returns zero economics for a zero-distance stop', () => {
    const plan = buildStructureRiskPlan({
      currentPrice: 100,
      direction: 'SHORT',
      stopLossPrice: 100,
      targetR: 2,
      maxLossValue: 10,
      feeRate: 0.001,
    });

    expect(plan.grossRiskRatio).toBe(0);
    expect(plan.rewardPerUnit).toBe(0);
    expect(plan.qty).toBe(0);
  });
});
