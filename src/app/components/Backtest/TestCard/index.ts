'use client';

import { TestCardChart } from './Chart';
import { TestCardRoot } from './Root';
import { TestCardStat } from './Stat';
import { TestCardTitle } from './Title';

export type { TestCompareList, OnChangeCompare } from './types';

export const TestCard = {
  Root: TestCardRoot,
  Title: TestCardTitle,
  Stat: TestCardStat,
  Chart: TestCardChart,
};
