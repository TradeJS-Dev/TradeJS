export const DEFAULT_BINANCE_PUBLIC_API_URL = 'https://data-api.binance.vision';

export const getBinancePublicApiUrl = () =>
  process.env.BINANCE_BASE_URL?.trim() || DEFAULT_BINANCE_PUBLIC_API_URL;
