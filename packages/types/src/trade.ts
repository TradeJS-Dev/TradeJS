import { KlineIntervalV3 } from 'bybit-api';

export type Interval = KlineIntervalV3;
export type Provider = 'bybit' | 'binance' | 'coinbase';

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  turnover: number;
  takerBuyBaseVolume?: number | null;
  takerBuyQuoteVolume?: number | null;
  takerSellBaseVolume?: number | null;
  takerSellQuoteVolume?: number | null;
}

export interface KlineChartItem extends Candle {
  dt: string;
  [key: string]: unknown;
}

export type KlineChartData = Array<KlineChartItem>;

export interface KlineRequest {
  symbol: string;
  interval: Interval;
  start?: number;
  end: number;
  silent?: boolean;
  cacheOnly?: boolean;
  warmOnly?: boolean;
}

export type DerivativesInterval = '15m' | '1h';

export type DerivativesRow = {
  symbol: string;
  interval: DerivativesInterval;
  ts: Date;
  openInterest?: number | null;
  fundingRate?: number | null;
  liqLong?: number | null;
  liqShort?: number | null;
  liqTotal?: number | null;
  source?: string | null;
};

export type DerivativesPressure =
  | 'neutral'
  | 'crowded_long'
  | 'crowded_short'
  | 'long_flush'
  | 'short_flush';

export type DerivativesPriceOiDivergenceType =
  | 'price_up_oi_up'
  | 'price_up_oi_down'
  | 'price_down_oi_up'
  | 'price_down_oi_down'
  | 'flat_or_mixed'
  | 'unknown';

export type DerivativesContextRiskFlag =
  | 'missing_derivatives'
  | 'stale_derivatives'
  | 'crowded_long'
  | 'crowded_short'
  | 'oi_falling'
  | 'oi_not_confirming'
  | 'long_liquidation_spike'
  | 'short_liquidation_spike';

export interface DerivativesIntervalContext {
  interval: DerivativesInterval;
  asOfTs: number | null;
  stale: boolean;
  points: number;
  openInterest: number | null;
  oiChangePct1h: number | null;
  oiChangePct4h: number | null;
  oiChangePct24h: number | null;
  fundingRate: number | null;
  fundingZScore: number | null;
  liqLong: number | null;
  liqShort: number | null;
  liqTotal: number | null;
  liqImbalance: number | null;
  liqSpikeRatio: number | null;
}

export interface DerivativesSymbolContext {
  source: 'coinalyze';
  symbol: string;
  timestamp: number;
  intervals: Partial<Record<DerivativesInterval, DerivativesIntervalContext>>;
  summary: {
    pressure: DerivativesPressure;
    directionAligned: boolean | null;
    riskFlags: DerivativesContextRiskFlag[];
    fundingChange1h?: number | null;
    oiAcceleration?: number | null;
    priceOiDivergenceType?: DerivativesPriceOiDivergenceType;
    crowdingPersistenceBars?: number | null;
  };
}

export interface DerivativesContext extends DerivativesSymbolContext {
  targetSymbol?: string;
  primaryReferenceSymbol?: string;
  referenceSymbols?: string[];
  referenceContexts?: Record<string, DerivativesSymbolContext>;
}

export type SpreadRow = {
  symbol: string;
  interval: DerivativesInterval;
  ts: Date;
  binancePrice?: number | null;
  coinbasePrice?: number | null;
  spread?: number | null;
  source?: string | null;
};

export type MarketFeatureInterval = '1m' | '5m' | '15m' | '1h';

export type MarketGlobalContextSource =
  | 'coinmarketcap_global'
  | 'coinmarketcap_global_hourly';

export type MarketGlobalContextRow = {
  source: MarketGlobalContextSource;
  ts: Date;
  updatedAt?: Date | null;
  activeCryptocurrencies?: number | null;
  activeExchanges?: number | null;
  activeMarketPairs?: number | null;
  markets?: number | null;
  totalMarketCapUsd?: number | null;
  totalVolumeUsd?: number | null;
  totalVolumeReportedUsd?: number | null;
  btcDominancePct?: number | null;
  ethDominancePct?: number | null;
  altMarketCapUsd?: number | null;
  altVolumeUsd?: number | null;
  altVolumeReportedUsd?: number | null;
  btcToAltMarketCapRatio?: number | null;
  marketCapChangePct24hUsd?: number | null;
};

export type MarketReferenceAssetContextRow = {
  source: 'coinmarketcap_reference_asset';
  symbol: 'BTCUSDT' | 'ETHUSDT' | string;
  cmcId: number;
  interval: '1d' | '1h';
  ts: Date;
  openUsd?: number | null;
  highUsd?: number | null;
  lowUsd?: number | null;
  closeUsd?: number | null;
  volumeUsd?: number | null;
  marketCapUsd?: number | null;
};

export type CmcMarketBreadthRegime =
  | 'risk_on'
  | 'risk_off'
  | 'alt_broadening'
  | 'btc_concentrated'
  | 'mixed'
  | 'neutral'
  | 'unknown';

export type MarketCmcBreadthContextRow = {
  source: 'coinmarketcap_market_breadth';
  universe: string;
  interval: '1d';
  ts: Date;
  topAssetsCount: number;
  assetsCount: number;
  positive24hPct?: number | null;
  positive7dPct?: number | null;
  avgReturn24hPct?: number | null;
  medianReturn24hPct?: number | null;
  avgReturn7dPct?: number | null;
  medianReturn7dPct?: number | null;
  returnDispersion24hPct?: number | null;
  returnDispersion7dPct?: number | null;
  top10MarketCapShare?: number | null;
  top25MarketCapShare?: number | null;
  btcMarketCapShare?: number | null;
  ethMarketCapShare?: number | null;
  btcEthMarketCapShare?: number | null;
  stablecoinMarketCapShare?: number | null;
  stablecoinVolumeShare?: number | null;
  totalMarketCapUsd?: number | null;
  totalVolumeUsd?: number | null;
  breadthRegime?: CmcMarketBreadthRegime | null;
};

export type CmcExchangeLiquidityRegime =
  | 'expanding'
  | 'contracting'
  | 'binance_led'
  | 'concentrated'
  | 'balanced'
  | 'thin'
  | 'unknown';

export type MarketCmcExchangeLiquidityContextRow = {
  source: 'coinmarketcap_exchange_liquidity';
  interval: '1d' | '1h';
  ts: Date;
  exchangesCount: number;
  totalVolumeUsd?: number | null;
  binanceVolumeUsd?: number | null;
  binanceVolumeShare?: number | null;
  topExchangeVolumeShare?: number | null;
  liquidityRegime?: CmcExchangeLiquidityRegime | null;
};

export type CmcFearGreedClassification =
  | 'Extreme Fear'
  | 'Fear'
  | 'Neutral'
  | 'Greed'
  | 'Extreme Greed'
  | 'Unknown';

export type CmcFearGreedRegime =
  | 'capitulation'
  | 'risk_off'
  | 'neutral'
  | 'risk_on'
  | 'euphoric'
  | 'unknown';

export type MarketCmcFearGreedContextRow = {
  source: 'coinmarketcap_fear_greed';
  interval: '1d';
  ts: Date;
  value: number;
  classification: CmcFearGreedClassification;
  sentimentRegime: CmcFearGreedRegime;
};

export type MarketBreadthRow = {
  universe: string;
  interval: MarketFeatureInterval;
  ts: Date;
  symbolsCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  advanceDeclineRatio?: number | null;
  pctAboveMa20?: number | null;
  pctAboveMa50?: number | null;
  equalWeightedReturn?: number | null;
  volumeWeightedReturn?: number | null;
  dispersion?: number | null;
  btcReturn1h?: number | null;
  btcReturn4h?: number | null;
  btcReturn24h?: number | null;
  altBasketReturn1h?: number | null;
  altBasketReturn4h?: number | null;
  altBasketReturn24h?: number | null;
  btcVsAltReturn1h?: number | null;
  btcVsAltReturn4h?: number | null;
  btcVsAltReturn24h?: number | null;
  btcTurnoverShare1h?: number | null;
  btcTurnoverShare24h?: number | null;
  btcTurnoverShareChange24h?: number | null;
  altVolToBtcVol24h?: number | null;
  altDispersion24h?: number | null;
  btcAltRegime?:
    | 'btc_lead'
    | 'alt_lead'
    | 'risk_off'
    | 'risk_on'
    | 'mixed'
    | 'neutral'
    | 'unknown'
    | null;
  source?: string | null;
};

export type MarketTradeFlowRow = {
  symbol: string;
  interval: MarketFeatureInterval;
  ts: Date;
  trades: number;
  buyBaseVolume?: number | null;
  sellBaseVolume?: number | null;
  buyQuoteVolume?: number | null;
  sellQuoteVolume?: number | null;
  netBaseDelta?: number | null;
  netQuoteDelta?: number | null;
  buyPressurePct?: number | null;
  source?: string | null;
};

export interface Tp {
  price: number;
  rate: number;
  done?: boolean;
}

export type Sl = number | null;

export type Direction = 'LONG' | 'SHORT';
export type Trend = 'BULL' | 'BEAR';

export type Order = {
  symbol: string;
  isLimit?: boolean;
  qty: number;
  price: number;
  timestamp: number;
  direction: Direction;
  orderId?: string;
  signal?: Signal;
};

export type Position = {
  symbol: string;
  qty: number;
  price: number;
  direction: Direction;
};

export interface PositionPnlSnapshot extends Position {
  currentPrice: number;
  unrealizedPnl: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  fundingFee?: number | null;
}

export type OrderType =
  | 'OPEN_LONG'
  | 'OPEN_SHORT'
  | 'CLOSE_LONG'
  | 'CLOSE_SHORT'
  | 'TAKE_PROFIT_LONG'
  | 'TAKE_PROFIT_SHORT'
  | 'STOP_LOSS_LONG'
  | 'STOP_LOSS_SHORT';

export type ConnectorCreator = (config: ConnectorConfig) => Promise<Connector>;

export interface ConnectorConfig {
  userName: string;
}

export interface ConnectorRegistryEntry {
  name: string;
  creator: ConnectorCreator;
  providers?: string[];
}

export interface ConnectorPluginDefinition {
  connectorEntries: ConnectorRegistryEntry[];
}

type GetPosition = (symbol: string) => Promise<Position | null>;
type GetPositions = () => Promise<Position[]>;
type GetOpenPositionPnl = () => Promise<PositionPnlSnapshot[]>;
export interface ClosedPnlRecord {
  symbol: string;
  qty: number;
  entryPrice: number | null;
  exitPrice: number | null;
  closedPnl: number;
  closedAt: number;
  direction?: Direction;
  entryTimestamp?: number;
  orderId?: string;
  orderLinkId?: string;
  openFee?: number | null;
  closeFee?: number | null;
  fundingFee?: number | null;
  totalFee?: number | null;
}

export interface ExchangeEntryRecord {
  symbol: string;
  qty: number;
  entryPrice: number | null;
  entryTimestamp: number;
  direction: Direction;
  orderId?: string;
  orderLinkId?: string;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  exitPrice?: number | null;
  exitTimestamp?: number | null;
  closedPnl?: number | null;
  openFee?: number | null;
  closeFee?: number | null;
  fundingFee?: number | null;
  totalFee?: number | null;
}

export interface GetClosedPnlParams {
  startTime: number;
  endTime: number;
  symbol?: string;
  limit?: number;
}

type GetClosedPnl = (params: GetClosedPnlParams) => Promise<ClosedPnlRecord[]>;
type GetEntryExecutions = (
  params: GetClosedPnlParams,
) => Promise<ExchangeEntryRecord[]>;
type PlaceOrder = (order: Order) => Promise<boolean>;
type ClosePosition = (order: Omit<Order, 'qty'>) => Promise<boolean>;
type SetTakeProfits = (params: {
  symbol: string;
  direction: Direction;
  qty?: number;
  takeProfits: Tp[];
}) => Promise<boolean>;
type SetStopLoss = (params: {
  symbol: string;
  direction: Direction;
  stopLossPrice: Sl;
}) => Promise<boolean>;
export type Kline = (options: KlineRequest) => Promise<KlineChartData>;
export type GetTickers = () => Promise<Ticker[]>;
export type GetTopOfBookTicker = (
  symbol: string,
) => Promise<TopOfBookTicker | null>;
export type GetAggTrades = (request: AggTradesRequest) => Promise<AggTrade[]>;
export type GetOrderBookDepth = (
  request: OrderBookDepthRequest,
) => Promise<OrderBookDepth | null>;

export interface Connector {
  kline: Kline;
  getState: () => Promise<object>;
  setState: (state: object) => Promise<void>;
  getPosition: GetPosition;
  getPositions: GetPositions;
  getOpenPositionPnl?: GetOpenPositionPnl;
  getClosedPnl?: GetClosedPnl;
  getEntryExecutions?: GetEntryExecutions;
  placeOrder: PlaceOrder;
  setTakeProfits: SetTakeProfits;
  setStopLoss: SetStopLoss;
  closePosition: ClosePosition;
  getTickers: GetTickers;
  getTopOfBookTicker?: GetTopOfBookTicker;
  getAggTrades?: GetAggTrades;
  getOrderBookDepth?: GetOrderBookDepth;
}

export interface Indicator {
  id: string;
  label: string;
  enabled: boolean;
  periods?: Array<number>;
}

export type Indicators = Indicator[];

export interface Filters {
  provider?: Provider;
  symbol: string;
  interval: Interval;
  start: number;
  end: number;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  indexPrice: number;
  markPrice: number;
  prevPrice24h: number;
  price24hPcnt: number;
  highPrice24h: number;
  lowPrice24h: number;
  prevPrice1h: number;
  openInterest: number;
  openInterestValue: number;
  turnover24h: number;
  volume24h: number;
  fundingRate: number;
  nextFundingTime: number;
  predictedDeliveryPrice: string;
  basisRate: string;
  deliveryFeeRate: string;
  deliveryTime: number;
  ask1Size: number;
  bid1Price: number;
  ask1Price: number;
  bid1Size: number;
  basis: string;
  preOpenPrice: string;
  preQty: string;
}

export interface TopOfBookTicker {
  symbol: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  timestamp?: number | null;
}

export interface AggTradesRequest {
  symbol: string;
  startTime: number;
  endTime: number;
  limit?: number;
}

export interface AggTrade {
  aggregateTradeId: number;
  price: number;
  quantity: number;
  firstTradeId: number;
  lastTradeId: number;
  timestamp: number;
  isBuyerMaker: boolean;
}

export interface OrderBookDepthRequest {
  symbol: string;
  limit?: 5 | 10 | 20 | 50 | 100 | 500 | 1000 | 5000;
}

export interface OrderBookDepth {
  symbol: string;
  lastUpdateId: number | null;
  bids: Array<[price: number, quantity: number]>;
  asks: Array<[price: number, quantity: number]>;
  timestamp: number;
}

export type TrendLineMode = 'lows' | 'highs';

export type TrendLine = {
  id: string;
  mode: TrendLineMode;
  distance: number;
  touches: { timestamp: number; value: number }[];
  points: { timestamp: number; value: number }[];
  alpha?: number[];
};

export interface StrategyFigurePoint {
  timestamp: number;
  value: number;
}

export interface StrategyFigureLine {
  id?: string;
  kind?: string;
  points: StrategyFigurePoint[];
  color?: string;
  width?: number;
  style?: 'solid' | 'dashed';
}

export interface StrategyFigurePoints {
  id?: string;
  kind?: string;
  points: StrategyFigurePoint[];
  color?: string;
  radius?: number;
}

export interface StrategyFigureZone {
  id?: string;
  kind?: string;
  start: StrategyFigurePoint;
  end: StrategyFigurePoint;
  color?: string;
  borderColor?: string;
}

export interface StrategyEntryModelFigures {
  lines?: StrategyFigureLine[];
  points?: StrategyFigurePoints[];
  zones?: StrategyFigureZone[];
}

export interface TrendLineOptions {
  mode: TrendLineMode;
  maxLines?: number; // ограничение перебора пар опор (кандидатов)
  range?: number; // окно для локальных экстремумов (в барах)
  epsilon?: number; // допуск как доля цены (0.01 = 1%) — применяется для касаний, фитилей между опорами и close-пробоев ДО offset
  epsilonOffset?: number; // размер окна в конце (в барах)
  minTouches?: number; // минимум касаний по телу (с учётом minTouchGap)
  minDistance?: number; // минимум баров между опорами/крайними касаниями
  firstRange?: number; // «сила» первой опоры (окно сильного экстремума)
  offset?: number; // размер окна в конце (в барах)
  minTouchGap?: number; // минимум баров между касаниями
  maxTouchGap?: number; // максимум баров между касаниями
  capture?: boolean; // true: в окне offset обязателен «старт за линией» и цвет свечи (строго, без допуска)
  bestLines?: number;
  maxDistance?: number;
}

export interface Signal {
  signalId: string;
  orderId?: string;
  symbol: string;
  interval: Interval;
  strategy: string;
  direction: Direction;
  timestamp: number;
  orderStatus?: SignalOrderStatus;
  orderSkipReason?: string;
  orderFailureReason?: string;
  orderQty?: number;
  orderValue?: number;
  isConfigFromBacktest?: boolean;
  aiAnalysis?: Partial<SignalAnalysis>;
  ml?: {
    probability: number;
    threshold: number;
    passed: boolean;
  };
  figures: {
    trendLine?: TrendLine;
    lines?: StrategyFigureLine[];
    points?: StrategyFigurePoints[];
    zones?: StrategyFigureZone[];
    [key: string]: any;
  };
  prices: {
    currentPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    riskRatio: number;
  };
  indicators: Record<string, any>;
  additionalIndicators?: Record<string, any>;
}

export type RuntimeSignalEvaluationStatus = 'signal' | 'skip' | 'error';

export interface RuntimeSignalEvaluationRecord {
  evaluationId: string;
  userName: string;
  strategy: string;
  symbol: string;
  interval: Interval;
  timestamp: number;
  evaluatedAt: number;
  status: RuntimeSignalEvaluationStatus;
  reason?: string;
  signalId?: string;
  direction?: Direction;
  orderStatus?: SignalOrderStatus;
  orderSkipReason?: string;
  aiAnalysis?: Partial<SignalAnalysis> | null;
  ml?: Signal['ml'];
}

export interface SignalAnalysis {
  direction: Direction | null;
  quality: 1 | 2 | 3 | 4 | 5 | number;
  needRetest: boolean;
  retestPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  setup?: string;
  confirmations?: string;
  btcContext?: string;
  retestPlan?: string;
  riskLevels?: string;
  qualityReason?: string;
  triggerInvalidation?: string;
  gateAnalysis?: Partial<SignalAnalysis>;
  gateContradictsLlm?: boolean;
  gateDecision?: 'approved' | 'rejected';
  llmDecision?: 'approved' | 'rejected';
  comment: string;
}

export interface RuntimeAiAnalysisSnapshot {
  strategy?: string;
  symbol: string;
  direction: Direction;
  timestamp: number;
  toleranceMs?: number;
  analysis: Partial<SignalAnalysis>;
}

export type SignalOrderStatus = 'completed' | 'failed' | 'skipped' | 'canceled';

export type RuntimeTradeStatus = 'active' | 'closed';
export type RuntimeTradeExitType = 'exit' | 'tp' | 'sl' | 'unknown';
export type RuntimeTradeFillSource =
  | 'exchange_position'
  | 'requested_price'
  | 'unknown';
export type RuntimeTradeTelemetryQuality =
  | 'full'
  | 'partial'
  | 'price_only'
  | 'none';

export interface RuntimeTradeRecord {
  orderId: string;
  signalId?: string;
  strategy: string;
  symbol: string;
  interval?: Interval;
  direction: Direction;
  qty: number;
  entryPrice: number;
  actualEntryPrice?: number | null;
  entryTimestamp: number;
  signalTimestamp?: number | null;
  signalClosePrice?: number | null;
  arrivalSnapshotTime?: number | null;
  arrivalSource?: string | null;
  arrivalMid?: number | null;
  bid?: number | null;
  ask?: number | null;
  spreadBps?: number | null;
  orderSubmitTime?: number | null;
  orderAckTime?: number | null;
  fillAvgPrice?: number | null;
  fillSource?: RuntimeTradeFillSource | null;
  fillTime?: number | null;
  telemetryQuality?: RuntimeTradeTelemetryQuality | null;
  fee?: number | null;
  status: RuntimeTradeStatus;
  currentPrice?: number | null;
  currentPnl?: number | null;
  closedPnl?: number | null;
  exitPrice?: number | null;
  actualExitPrice?: number | null;
  exitTimestamp?: number | null;
  exitType?: RuntimeTradeExitType | null;
  openFee?: number | null;
  closeFee?: number | null;
  fundingFee?: number | null;
  totalFee?: number | null;
  aiAnalysis?: Partial<SignalAnalysis> | null;
  lastSyncedAt?: number;
}

export interface RuntimeStrategyCloseNotification {
  userName?: string;
  strategy: string;
  openedByStrategy: string;
  symbol: string;
  direction: Direction;
  code: string;
  orderId: string;
  signalId?: string;
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  exitPrice?: number | null;
  exitTimestamp?: number | null;
  closedPnl?: number | null;
  exitType?: RuntimeTradeExitType | null;
}
