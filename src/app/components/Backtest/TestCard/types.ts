import { Tokens } from '@chakra-ui/react';
import { OrderLogData, Test } from '@types';

export type ChartColor = Tokens['colors'] | React.CSSProperties['color'];

type ItemDataKey<T> = keyof T;

interface SeriesItem<T> {
  name?: ItemDataKey<T>;
  color?: ChartColor;
  icon?: React.ReactNode;
  label?: React.ReactNode;
  stackId?: string;
  yAxisId?: string;
  strokeDasharray?: string;
  id?: string;
}

interface UseChartProps<T> {
  data: T[];
  series?: SeriesItem<T>[];
  sort?: {
    by: ItemDataKey<T>;
    direction: 'asc' | 'desc';
  };
}

interface TestCompare {
  testId: string;
  orderLog: OrderLogData;
  color: ChartColor;
}

export type TestCompareList = TestCompare[];

export type OnChangeCompare = (
  testId: string,
  orderLog: OrderLogData | null,
) => void;
