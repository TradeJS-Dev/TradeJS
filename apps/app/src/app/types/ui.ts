import type { Filters, Item, Items } from '@tradejs/types';

export type { Item, Items };

export interface Figure {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  color: string;
  width: number;
  height: number;
  text?: string;
}

export interface UIFilters extends Filters {
  backtestId: string | null;
  backtestStrategy: string | null;
}

export type OnChangeFilters = (filters: Partial<UIFilters>) => void;
