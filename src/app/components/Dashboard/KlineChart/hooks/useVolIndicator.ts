import { useEffect } from 'react';
import { Chart } from 'klinecharts';

export const useVolIndicator = (chart: Chart | null, enabled: boolean) => {
  useEffect(() => {
    if (!chart || !enabled) {
      return () => null;
    }

    chart.createIndicator('VOL');

    return () => {
      chart.removeIndicator({ name: 'VOL' });
    };
  }, [chart, enabled]);
};
