import { StrategyAiAdapter } from '@types';
import { mapAiRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import type { TrendLineConfig } from '../config';

/**
 * TrendLine AI adapter extends the shared AI pipeline (`src/utils/ai.ts`):
 * - `buildPayload` overrides payload fields when strategy needs richer context
 * - `buildSystemPromptAddon` appends strategy-specific analysis rules
 * - `buildHumanPromptAddon` is reserved for future per-strategy user-prompt additions
 *
 * Base prompt/payload stays in shared `ai.ts`; strategy adapters only add/override
 * strategy-specific context so the final prompt remains complete but modular.
 */
const TRENDLINE_CONTEXT_PROMPT = `
Дополнение для trendline-сетапов:
- Это сетап на основе пробоя/реакции от трендовой линии; поле figures.trendline содержит геометрию этой линии.
- Для TrendLine роль геометрии/структуры цены приоритетнее индикаторных подтверждений.
`;

const TRENDLINE_PAYLOAD_PROMPT = `
- В payload.figures.trendline передается полная геометрия трендовой линии (без trim), чтобы можно было оценивать касания/структуру.
`;

export const trendLineAiAdapter: StrategyAiAdapter = {
  // Shared builder trims nested series/figures; TrendLine keeps trendline geometry untrimmed on purpose.
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    figures: {
      ...basePayload.figures,
      // Keep trendline geometry untrimmed for LLM reasoning.
      trendline: signal.figures?.trendLine ?? null,
    },
  }),
  buildSystemPromptAddon: () =>
    `\n${TRENDLINE_CONTEXT_PROMPT}\n${TRENDLINE_PAYLOAD_PROMPT}\n`,
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<TrendLineConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
  // Intentionally omitted now: base human prompt is sufficient.
  // buildHumanPromptAddon: () => '',
};
