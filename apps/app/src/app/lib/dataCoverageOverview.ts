import type { DataCoverage } from '@tradejs/types';

export type SavedCoverage = {
  dataset: string;
  coverage: DataCoverage;
  calculatedAt: number;
};
