import _ from 'lodash';
import { useEffect, useRef } from 'react';
import { Chart } from 'klinecharts';
import { useData as useDataStore } from '@store';
import { Filters } from '@types';

export const useData = (chart: Chart | null, filters: Filters) => {
  const { data, updateData, fulfilled } = useDataStore(filters);
  const updateFnRef = useRef(updateData);

  useEffect(() => {
    updateFnRef.current = updateData;
  }, [updateData]);

  useEffect(() => {
    if (!fulfilled || !chart) {
      return;
    }

    chart.applyNewData(data);

    const intervalId = setInterval(async () => {
      const dataList = chart.getDataList();

      const { data: newData } = await updateFnRef.current?.();

      if (_.isEmpty(dataList)) {
        return;
      }

      const dataByTimestamp = _.keyBy(dataList, 'timestamp');

      if (newData.length > 0) {
        console.info('last candle ts', newData[newData.length - 1]?.timestamp);
      }

      const updatedCandles = newData.filter((c) => {
        const prevCandle = dataByTimestamp[c.timestamp];

        if (!prevCandle) {
          return false;
        }

        if (
          prevCandle.close !== c.close ||
          prevCandle.open !== c.open ||
          prevCandle.high !== c.high ||
          prevCandle.low !== c.low ||
          prevCandle.volume !== c.volume ||
          prevCandle.turnover !== c.turnover
        ) {
          return true;
        }

        return false;
      });

      updatedCandles.forEach((candle) => {
        try {
          if (!dataList.some((c) => c.timestamp === candle.timestamp)) {
            return;
          }

          chart.updateData(candle);
        } catch (err) {
          console.error('updateData:', err);
        }
      });

      const newCandles = newData.filter((c) => {
        const prevCandle = dataByTimestamp[c.timestamp];

        if (!prevCandle) {
          return true;
        }

        return false;
      });

      console.info('>>> new candles', newCandles);

      if (!_.isEmpty(newCandles)) {
        chart.applyNewData([...dataList, ...newCandles], {
          forward: true,
        });
      }
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [fulfilled]);

  return { data, fulfilled };
};
