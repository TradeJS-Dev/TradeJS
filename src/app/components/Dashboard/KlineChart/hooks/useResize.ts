import { useEffect } from 'react';
import { Chart } from 'klinecharts';

export const useResize = (
  chartRef: React.MutableRefObject<Chart | null>,
  id: string,
) => {
  useEffect(() => {
    const chartElement = document.getElementById(id);

    const resize = () => {
      if (!chartElement) return;

      const parent = chartElement.parentElement;

      if (!parent) return;

      const parentStyles = window.getComputedStyle(parent);
      chartElement.style.width = parentStyles.width;
      chartElement.style.height = parentStyles.height;
      chartRef.current?.resize();
    };

    const resizeObserver = new ResizeObserver(resize);

    resizeObserver.observe(document.body);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);
};
