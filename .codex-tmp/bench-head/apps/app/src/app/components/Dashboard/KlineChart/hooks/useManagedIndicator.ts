import { useEffect, useState } from 'react';
import { Chart, registerIndicator } from 'klinecharts';

type CalcFn = (
  kLineDataList: any[],
) => Record<number, Record<string, number | undefined>>;

type IndicatorTemplate = {
  shortName: string;
  calcParams: unknown[];
  figures: Array<Record<string, unknown>>;
};

interface UseManagedIndicatorParams {
  chart: Chart | null;
  enabled: boolean;
  indicatorName: string;
  indicatorId: string;
  paneId: string;
  minHeight?: number;
  template: IndicatorTemplate;
  calc: CalcFn;
  updateDeps: unknown[];
}

const removeIndicator = (
  chart: Chart,
  params: Pick<UseManagedIndicatorParams, 'indicatorId' | 'indicatorName'>,
) => {
  chart.removeIndicator({ id: params.indicatorId });
  chart.removeIndicator({ name: params.indicatorName });
};

const hasIndicator = (
  chart: Chart,
  params: Pick<UseManagedIndicatorParams, 'indicatorId'>,
) => chart.getIndicators({ id: params.indicatorId }).length > 0;

const createIndicator = (
  chart: Chart,
  params: Pick<
    UseManagedIndicatorParams,
    'indicatorName' | 'indicatorId' | 'paneId' | 'minHeight'
  >,
) => {
  chart.createIndicator(
    { name: params.indicatorName, id: params.indicatorId },
    true,
    {
      id: params.paneId,
      minHeight: params.minHeight ?? 100,
    },
  );
};

const ensureIndicator = (
  chart: Chart,
  params: Pick<
    UseManagedIndicatorParams,
    'indicatorName' | 'indicatorId' | 'paneId' | 'minHeight'
  >,
) => {
  if (hasIndicator(chart, { indicatorId: params.indicatorId })) return;
  createIndicator(chart, params);
};

export const useManagedIndicator = ({
  chart,
  enabled,
  indicatorName,
  indicatorId,
  paneId,
  minHeight = 100,
  template,
  calc,
  updateDeps,
}: UseManagedIndicatorParams) => {
  const [registered, setRegistered] = useState(false);
  const updateDepsKey = JSON.stringify(updateDeps);

  useEffect(() => {
    if (registered) return;

    registerIndicator({
      name: indicatorName,
      shortName: template.shortName,
      calcParams: template.calcParams,
      figures: template.figures as any,
      calc,
    });

    setRegistered(true);
  }, [registered, indicatorName, template, calc]);

  useEffect(() => {
    if (!registered || !chart) return;

    if (!enabled) {
      removeIndicator(chart, { indicatorId, indicatorName });
      return;
    }

    ensureIndicator(chart, { indicatorName, indicatorId, paneId, minHeight });

    return () => {
      removeIndicator(chart, { indicatorId, indicatorName });
    };
  }, [
    chart,
    enabled,
    registered,
    indicatorName,
    indicatorId,
    paneId,
    minHeight,
  ]);

  useEffect(() => {
    if (!registered || !chart || !enabled) return;

    const updated = chart.overrideIndicator({
      name: indicatorName,
      calc,
    });

    if (!updated) {
      ensureIndicator(chart, { indicatorName, indicatorId, paneId, minHeight });
    }
  }, [
    chart,
    enabled,
    registered,
    indicatorName,
    indicatorId,
    paneId,
    minHeight,
    calc,
    updateDepsKey,
  ]);
};
