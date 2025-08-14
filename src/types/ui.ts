import { Filters } from './trade';

export interface Item {
  label: string;
  value: string;
  description?: string;
  data?: Record<string, string | number | boolean>;
}

export type Items = Item[];

export interface Figure {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  color: string;
  width: number;
  height: number;
}

export interface UIFilters extends Filters {
  backtestId: string | null;
}

export type OnChangeFilters = (filters: UIFilters) => void;
