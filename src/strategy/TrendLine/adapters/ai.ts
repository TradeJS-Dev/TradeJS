import { StrategyAiAdapter } from '@types';

export const trendLineAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    figures: {
      ...basePayload.figures,
      // Keep trendline geometry untrimmed for LLM reasoning.
      trendline: signal.figures?.trendLine ?? null,
    },
  }),
  buildSystemPromptAddon: () => `

Дополнение для trendline-сетапов:
- Если strategy = "TrendLine" (или аналогичное имя), это сетап на основе пробоя/реакции от трендовой линии; поле figures.trendline содержит геометрию этой линии.
- Для TrendLine роль геометрии/структуры цены приоритетнее индикаторных подтверждений.
`,
};
