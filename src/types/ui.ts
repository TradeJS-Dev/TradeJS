import { Filters } from './trade';

export interface Item<T = Record<string, string | number | boolean>> {
  label: string;
  value: string;
  description?: string;
  data?: T;
}

export type Items = Item[];

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
}

export type OnChangeFilters = (filters: Partial<UIFilters>) => void;
