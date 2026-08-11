export interface Item<T = Record<string, string | number | boolean>> {
  label: string;
  value: string;
  description?: string;
  data?: T;
}

export type Items = Item[];
