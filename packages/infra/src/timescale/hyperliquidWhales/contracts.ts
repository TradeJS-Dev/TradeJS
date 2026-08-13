export type HyperliquidWhaleWalletCoverageStatus =
  | 'complete'
  | 'truncated'
  | 'failed';

export type HyperliquidWhaleCoverageRebuildProgress = {
  chunkIndex: number;
  totalChunks: number;
  completedBuckets: number;
  totalBuckets: number;
  rows: number;
};
