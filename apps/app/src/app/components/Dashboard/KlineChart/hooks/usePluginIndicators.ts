import { useEffect, useMemo, useRef } from 'react';
import { Chart, registerIndicator } from 'klinecharts';
import { Indicator, KlineChartData } from '@types';
import { IndicatorRendererConfig } from '@store';

type RenderersMap = Record<string, IndicatorRendererConfig>;

const getRuntimeIds = (
  indicatorId: string,
  renderer: IndicatorRendererConfig,
) => {
  const normalized = indicatorId.replace(/[^a-zA-Z0-9_]/g, '_');
  return {
    indicatorName:
      renderer.indicatorName || `PLUGIN_${normalized.toUpperCase()}`,
    indicatorRuntimeId: `plugin_indicator_${normalized}`,
    paneId: renderer.paneId || `plugin_indicator_${normalized}_pane`,
  };
};

const createFigureStyles = (
  figure: IndicatorRendererConfig['figures'][number],
) => {
  if (!figure.color && !figure.lineWidth && !figure.dashed) {
    return undefined;
  }

  return () =>
    ({
      color: figure.color,
      size: figure.lineWidth,
      style: figure.dashed ? 'dashed' : undefined,
      dashedValue: figure.dashed ? [4, 4] : undefined,
    }) as any;
};

const createCalc = (renderer: IndicatorRendererConfig) => {
  const figures = renderer.figures || [];

  return (
    kLineDataList: Array<{ timestamp?: number } & Record<string, unknown>>,
  ) => {
    return kLineDataList.reduce<
      Record<number, Record<string, number | undefined>>
    >((acc, candle) => {
      const timestampRaw = candle.timestamp;
      const timestamp = Number(timestampRaw);
      if (!Number.isFinite(timestamp)) {
        return acc;
      }

      const point: Record<string, number | undefined> = {};

      for (const figure of figures) {
        if (
          typeof figure.constant === 'number' &&
          Number.isFinite(figure.constant)
        ) {
          point[figure.key] = figure.constant;
          continue;
        }

        const raw = candle[figure.key];
        const value = Number(raw);
        point[figure.key] = Number.isFinite(value) ? value : undefined;
      }

      acc[timestamp] = point;
      return acc;
    }, {});
  };
};

const removeIndicator = (
  chart: Chart,
  indicatorName: string,
  indicatorRuntimeId: string,
) => {
  chart.removeIndicator({ id: indicatorRuntimeId });
  chart.removeIndicator({ name: indicatorName });
};

const ensureIndicator = (
  chart: Chart,
  indicatorName: string,
  indicatorRuntimeId: string,
  paneId: string,
  minHeight = 100,
) => {
  if (chart.getIndicators({ id: indicatorRuntimeId }).length > 0) {
    return;
  }

  chart.createIndicator({ name: indicatorName, id: indicatorRuntimeId }, true, {
    id: paneId,
    minHeight,
  });
};

export const usePluginIndicators = (
  chart: Chart | null,
  indicators: Record<string, Indicator>,
  indicatorRenderers: RenderersMap,
  data: KlineChartData,
) => {
  const registeredIndicatorsRef = useRef(new Set<string>());

  const entries = useMemo(
    () =>
      Object.entries(indicatorRenderers || {}).filter(
        ([, renderer]) => renderer?.figures?.length,
      ) as Array<[string, IndicatorRendererConfig]>,
    [indicatorRenderers],
  );

  useEffect(() => {
    for (const [indicatorId, renderer] of entries) {
      const { indicatorName } = getRuntimeIds(indicatorId, renderer);
      if (registeredIndicatorsRef.current.has(indicatorName)) {
        continue;
      }

      registerIndicator({
        name: indicatorName,
        shortName:
          renderer.shortName || indicators[indicatorId]?.label || indicatorId,
        calcParams: [],
        figures: renderer.figures.map((figure) => ({
          key: figure.key,
          title: figure.title || `${figure.key}: `,
          type: figure.type || 'line',
          styles: createFigureStyles(figure),
        })) as any,
        calc: createCalc(renderer) as any,
      });

      registeredIndicatorsRef.current.add(indicatorName);
    }
  }, [entries, indicators]);

  useEffect(() => {
    if (!chart) {
      return;
    }

    for (const [indicatorId, renderer] of entries) {
      const { indicatorName, indicatorRuntimeId, paneId } = getRuntimeIds(
        indicatorId,
        renderer,
      );

      const enabled = Boolean(indicators[indicatorId]?.enabled);

      if (!enabled) {
        removeIndicator(chart, indicatorName, indicatorRuntimeId);
        continue;
      }

      ensureIndicator(
        chart,
        indicatorName,
        indicatorRuntimeId,
        paneId,
        renderer.minHeight,
      );

      const updated = chart.overrideIndicator({
        name: indicatorName,
        calc: createCalc(renderer) as any,
      });

      if (!updated) {
        ensureIndicator(
          chart,
          indicatorName,
          indicatorRuntimeId,
          paneId,
          renderer.minHeight,
        );
      }
    }
  }, [chart, entries, indicators, data]);

  useEffect(() => {
    return () => {
      if (!chart) {
        return;
      }
      for (const [indicatorId, renderer] of entries) {
        const { indicatorName, indicatorRuntimeId } = getRuntimeIds(
          indicatorId,
          renderer,
        );
        removeIndicator(chart, indicatorName, indicatorRuntimeId);
      }
    };
  }, [chart, entries]);
};
