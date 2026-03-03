import { useEffect } from 'react';
import { Chart } from 'klinecharts';

export const useVolIndicator = (chart: Chart | null, enabled: boolean) => {
  useEffect(() => {
    if (!chart || !enabled) {
      return () => null;
    }

    setTimeout(() => {
      chart.createIndicator('VOL', true, { minHeight: 80 });
    }, 100);

    return () => {
      chart.removeIndicator({ name: 'VOL' });
    };
  }, [chart, enabled]);
};
