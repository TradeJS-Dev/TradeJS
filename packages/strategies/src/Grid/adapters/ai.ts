import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import type { GridConfig } from '../config';
import type { GridSignalContext } from '../engine';
import {
  buildGridGuardrailContext,
  type GridGateFeatures,
} from '../guardrails';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getGridContext = (payload: AiPayload) =>
  asRecord(
    asRecord(payload.additionalIndicators).gridContext,
  ) as Partial<GridSignalContext>;

const getGridGuardrailContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  return buildGridGuardrailContext({
    signalContext: getGridContext(payload),
    baseContext: (additional.baseContext ??
      null) as BaseStrategyContextSnapshot | null,
  });
};

const withGridGateFeatures = ({
  baseContext,
  context,
}: {
  baseContext: BaseStrategyContextSnapshot | null;
  context: ReturnType<typeof buildGridGuardrailContext>;
}) =>
  baseContext == null
    ? baseContext
    : ({
        ...(baseContext as unknown as Record<string, unknown>),
        gridGateFeatures: context.gridGateFeatures,
      } as BaseStrategyContextSnapshot & {
        gridGateFeatures: GridGateFeatures;
      });

export const gridAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const baseAdditional = asRecord(basePayload.additionalIndicators);
    const baseContext = (baseAdditional.baseContext ??
      null) as BaseStrategyContextSnapshot | null;
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...baseAdditional,
        gridContext: asRecord(signal.additionalIndicators).gridContext,
      },
    };
    const context = getGridGuardrailContext(payload);
    const additionalIndicators: Record<string, unknown> = {
      ...asRecord(payload.additionalIndicators),
      gridContext: context,
    };
    const enrichedBaseContext = withGridGateFeatures({
      baseContext,
      context,
    });
    if (enrichedBaseContext != null) {
      additionalIndicators.baseContext = enrichedBaseContext;
    }

    return {
      ...payload,
      additionalIndicators,
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getGridGuardrailContext(payload);
    const approved =
      context.approvalAllowedNow === true && context.signalDirection != null;

    return {
      ...analysis,
      direction: approved ? context.signalDirection : null,
      quality: context.deterministicQuality,
      approved,
      rejectReason: approved
        ? undefined
        : context.approvalBlockReasons.join('; ') ||
          'Grid signal is outside the validated market pockets.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getGridGuardrailContext(payload);
    return `
Additional adaptive directional Grid context:
- action=${String(context.action ?? 'n/a')}
- level=${String(context.level ?? 'n/a')}
- levelsFilled=${String(context.levelsFilled ?? 'n/a')}
- regimeDirection=${String(context.regimeDirection ?? 'n/a')}
- atrPct=${String(context.atrPct ?? 'n/a')}
- slowSlopeAtr=${String(context.slowSlopeAtr ?? 'n/a')}
- trendStrengthAtr=${String(context.trendStrengthAtr ?? 'n/a')}
- candleRangeAtr=${String(context.candleRangeAtr ?? 'n/a')}
- stepDistance=${String(context.stepDistance ?? 'n/a')}
- projectedAveragePrice=${String(context.projectedAveragePrice ?? 'n/a')}
- projectedQty=${String(context.projectedQty ?? 'n/a')}
- stopLossPrice=${String(context.stopLossPrice ?? 'n/a')}
- takeProfitPrice=${String(context.takeProfitPrice ?? 'n/a')}
- venueSpread=${String(context.gridGateFeatures.venueSpread ?? 'n/a')}
- benchmarkLiquidations15m=${String(context.gridGateFeatures.benchmarkLiquidations15m ?? 'n/a')}
- longLiquidationDislocationPocket=${String(context.gridGateFeatures.longLiquidationDislocationPocket)}
- solOiChangePct1h=${String(context.gridGateFeatures.solOiChangePct1h ?? 'n/a')}
- solDerivativesFresh15m=${String(context.gridGateFeatures.solDerivativesFresh15m)}
- shortSolOiExpansionPocket=${String(context.gridGateFeatures.shortSolOiExpansionPocket)}
- bnbDirectionAligned=${String(context.gridGateFeatures.bnbDirectionAligned ?? 'n/a')}
- bnbDerivativesFresh15m=${String(context.gridGateFeatures.bnbDerivativesFresh15m)}
- shortBnbDirectionAlignmentPocket=${String(context.gridGateFeatures.shortBnbDirectionAlignmentPocket)}
- deterministicQuality=${String(context.deterministicQuality)}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- approvalBlockReasons=${context.approvalBlockReasons.join(',') || 'none'}

Interpretation rules:
- This is a non-martingale directional grid. An increase adds the same configured level size or less when the remaining MAX_LOSS_VALUE budget is smaller.
- Treat deterministicQuality and approvalAllowedNow as the normalized local gate result.
- Approve only when the direction still matches the causal trend regime, volatility is not shocked, and a validated direction-specific market pocket is active.
- SHORT approvals require fresh SOL open-interest expansion or fresh BNB derivatives alignment. The legacy liquidation-dislocation pocket is valid only for LONG.
- Treat the hard stop and aggregate risk budget as immutable constraints.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<GridConfig, 'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'>,
    ),
};
