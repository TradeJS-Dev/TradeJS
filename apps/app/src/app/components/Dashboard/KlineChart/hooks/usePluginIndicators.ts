import { useEffect, useMemo, useRef } from 'react';
import { Chart, registerIndicator } from 'klinecharts';
import { Indicator, KlineChartData } from '@types';
import { IndicatorRendererConfig } from '@store';

type RenderersMap = Record<string, IndicatorRendererConfig>;
type RuntimeEntry = {
  indicatorId: string;
  enabled: boolean;
  indicatorName: string;
  indicatorRuntimeId: string;
  paneId: string;
  minHeight: number;
  shortName: string;
  figures: IndicatorRendererConfig['figures'];
  calc: ReturnType<typeof createCalc>;
};

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

  const runtimeEntries = useMemo<RuntimeEntry[]>(
    () =>
      Object.entries(indicatorRenderers || {})
        .filter(([, renderer]) => renderer?.figures?.length)
        .map(([indicatorId, renderer]) => {
          const ids = getRuntimeIds(indicatorId, renderer);
          return {
            indicatorId,
            enabled: Boolean(indicators[indicatorId]?.enabled),
            indicatorName: ids.indicatorName,
            indicatorRuntimeId: ids.indicatorRuntimeId,
            paneId: ids.paneId,
            minHeight: renderer.minHeight ?? 100,
            shortName:
              renderer.shortName ||
              indicators[indicatorId]?.label ||
              indicatorId,
            figures: renderer.figures,
            calc: createCalc(renderer),
          };
        }),
    [indicatorRenderers, indicators],
  );

  useEffect(() => {
    for (const entry of runtimeEntries) {
      if (registeredIndicatorsRef.current.has(entry.indicatorName)) {
        continue;
      }

      registerIndicator({
        name: entry.indicatorName,
        shortName: entry.shortName,
        calcParams: [],
        figures: entry.figures.map((figure) => ({
          key: figure.key,
          title: figure.title || `${figure.key}: `,
          type: figure.type || 'line',
          styles: createFigureStyles(figure),
        })) as any,
        calc: entry.calc as any,
      });

      registeredIndicatorsRef.current.add(entry.indicatorName);
    }
  }, [runtimeEntries]);

  useEffect(() => {
    if (!chart) {
      return;
    }

    for (const entry of runtimeEntries) {
      if (!entry.enabled) {
        removeIndicator(chart, entry.indicatorName, entry.indicatorRuntimeId);
        continue;
      }

      ensureIndicator(
        chart,
        entry.indicatorName,
        entry.indicatorRuntimeId,
        entry.paneId,
        entry.minHeight,
      );

      const updated = chart.overrideIndicator({
        name: entry.indicatorName,
        calc: entry.calc as any,
      });

      if (!updated) {
        ensureIndicator(
          chart,
          entry.indicatorName,
          entry.indicatorRuntimeId,
          entry.paneId,
          entry.minHeight,
        );
      }
    }
  }, [chart, runtimeEntries, data]);

  useEffect(() => {
    return () => {
      if (!chart) {
        return;
      }
      for (const entry of runtimeEntries) {
        removeIndicator(chart, entry.indicatorName, entry.indicatorRuntimeId);
      }
    };
  }, [chart, runtimeEntries]);
};
