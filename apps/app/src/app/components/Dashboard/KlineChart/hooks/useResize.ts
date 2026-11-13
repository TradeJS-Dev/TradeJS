import { useEffect } from 'react';
import { Chart } from 'klinecharts';

export const useResize = (chart: Chart | null, id: string) => {
  useEffect(() => {
    const chartElement = document.getElementById(id);
    const parent = chartElement?.parentElement;
    if (!chartElement || !parent) return;

    const resize = () => {
      chartElement.style.width = `${parent.clientWidth}px`;
      chartElement.style.height = `${parent.clientHeight}px`;
      chart?.resize();
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    return () => resizeObserver.disconnect();
  }, [chart, id]);
};
