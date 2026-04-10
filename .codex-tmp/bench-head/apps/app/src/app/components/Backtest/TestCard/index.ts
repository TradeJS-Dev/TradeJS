'use client';

import { TestCardChart } from './Chart';
import { TestCardRoot } from './Root';
import { TestCardStatLine, TestCardStatTable } from './Stat';
import { TestCardTitle } from './Title';
import { TestCardSkeleton } from './Skeleton';
import { TestCardConfigDrawer } from './ConfigDrawer';
import { TestCardCompareButton } from './CompareButton';
import { TestCardFavoriteIndicator } from './FavoriteIndicator';
import { TestCardOpenReportButton } from './OpenReportButton';
import { TestCardOpenDashboardButton } from './OpenDashboardButton';
import { TestCardDeleteButton } from './DeleteButton';

export const TestCard = {
  Root: TestCardRoot,
  Title: TestCardTitle,
  StatLine: TestCardStatLine,
  StatTable: TestCardStatTable,
  Chart: TestCardChart,
  Skeleton: TestCardSkeleton,
  ConfigDrawer: TestCardConfigDrawer,
  CompareButton: TestCardCompareButton,
  FavoriteIndicator: TestCardFavoriteIndicator,
  OpenDashboardButton: TestCardOpenDashboardButton,
  OpenReportButton: TestCardOpenReportButton,
  DeleteButton: TestCardDeleteButton,
};
