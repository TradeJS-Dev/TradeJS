import type { TradejsConfig } from '@tradejs/core/config';

export const basePreset: TradejsConfig = {
  strategies: ['@tradejs/strategies'],
  indicators: ['@tradejs/indicators'],
  connectors: ['@tradejs/connectors'],
};

export default basePreset;
