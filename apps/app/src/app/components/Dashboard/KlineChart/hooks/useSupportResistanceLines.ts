'use client';

import { useEffect } from 'react';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSupportResistanceLevels } from '@tradejs/core/indicators';

type SupportResistanceOverlayPoint = {
  timestamp: number;
  value: number;
};

export const useSupportResistanceLines = (
  chart: Chart | null,
  enabled: boolean,
) => {
  const data = chart?.getDataList();

  // регистрируем оверлеи один раз
  useEffect(() => {
    registerOverlay({
      name: 'SupportLine',
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates }) => {
        if (coordinates.length < 2) return [];
        return [
          {
            type: 'line',
            attrs: {
              coordinates: [coordinates[0], coordinates[1]],
            },
            styles: {
              color: '#22c55e', // зелёный
              size: 1,
              style: 'dashed',
            },
          },
        ];
      },
    });

    registerOverlay({
      name: 'ResistanceLine',
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates }) => {
        if (coordinates.length < 2) return [];
        return [
          {
            type: 'line',
            attrs: {
              coordinates: [coordinates[0], coordinates[1]],
            },
            styles: {
              color: '#ef4444', // красный
              size: 1,
              style: 'dashed',
            },
          },
        ];
      },
    });
  }, []);

  useEffect(() => {
    if (!chart || !enabled || !data || _.isEmpty(data)) return;

    // находим уровни
    const { supportLevels, resistanceLevels } =
      getSupportResistanceLevels(data);

    // конструируем точки для горизонтальных линий:
    // нам нужна линия "цена = const" через всю видимую область.
    // У оверлея klinecharts минимум 2 точки [ (t1,price), (t2,price) ].
    // Возьмём первую и последнюю свечу, чтобы растянуть линию.
    const first = data[0];
    const last = data[data.length - 1];

    const firstTs = first.timestamp;
    const lastTs = last.timestamp;

    // SUPPORT
    for (const level of supportLevels) {
      const points: SupportResistanceOverlayPoint[] = [
        { timestamp: firstTs, value: level.price },
        { timestamp: lastTs, value: level.price },
      ];

      chart.createOverlay({
        name: 'SupportLine',
        id: level.id,
        points,
      });
    }

    // RESISTANCE
    for (const level of resistanceLevels) {
      const points: SupportResistanceOverlayPoint[] = [
        { timestamp: firstTs, value: level.price },
        { timestamp: lastTs, value: level.price },
      ];

      chart.createOverlay({
        name: 'ResistanceLine',
        id: level.id,
        points,
      });
    }

    // cleanup: убрать все созданные уровни при следующем ререндере
    return () => {
      if (supportLevels.length) {
        chart.removeOverlay({ name: 'SupportLine' });
      }
      if (resistanceLevels.length) {
        chart.removeOverlay({ name: 'ResistanceLine' });
      }
    };
  }, [chart, enabled, data]);
};
