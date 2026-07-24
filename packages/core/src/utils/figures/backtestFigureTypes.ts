import {
  StrategyFigureAnnotation,
  StrategyFigureLine,
  StrategyFigurePoints,
  StrategyFigureZone,
} from '@tradejs/types';

export type MarkerShape =
  | 'RECT'
  | 'DIAMOND'
  | 'STAR'
  | 'CIRCLE'
  | 'SQUARE'
  | 'TRIANGLE';

export interface MarkerMeta {
  shape: MarkerShape;
  color: string;
  timestamp: number;
  value: number;
  type: string;
  profit: number;
  amount: number;
  tradeIndex: number;
}

export interface EntryLineExtendData {
  line: StrategyFigureLine;
}

export interface EntryPointsExtendData {
  points: StrategyFigurePoints;
}

export interface EntryZoneExtendData {
  zone: StrategyFigureZone;
}

export interface EntryAnnotationExtendData {
  annotation: StrategyFigureAnnotation;
}
