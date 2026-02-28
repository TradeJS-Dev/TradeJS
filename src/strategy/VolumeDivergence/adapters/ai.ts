import { StrategyAiAdapter } from '@types';
import { mapAiRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import type { VolumeDivergenceConfig } from '../config';

const VOLUME_DIVERGENCE_CONTEXT_PROMPT = `
Дополнение для Volume Divergence Reversal Signals:
- Сигнал строится на дивергенции цены и нормализованного объема (0-100).
- Bullish divergence: price делает lower low, volume делает higher low.
- Bearish divergence: price делает higher high, volume делает lower high.
- В additionalIndicators.deltaAtPivot передается proxy net-volume (оценка по телу свечи), это не lower-timeframe volume delta TradingView.
`;

export const volumeDivergenceAiAdapter: StrategyAiAdapter = {
  buildSystemPromptAddon: () => `\n${VOLUME_DIVERGENCE_CONTEXT_PROMPT}\n`,
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<VolumeDivergenceConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
};
