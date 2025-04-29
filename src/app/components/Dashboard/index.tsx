'use client';

import React from 'react';
import { SelectSymbol, SelectInterval } from './Filters';
import { MainChart } from './MainChart';
import { SubChart } from './SubChart';

export const Dashboard = () => {
  return (
    <>
      <div className="p-2 flex flex-row gap-8">
        <SelectSymbol />
        <SelectInterval />
      </div>
      <div className="flex-1 w-full">
        <MainChart />
      </div>
      <div className="flex-1 w-full">
        <SubChart />
      </div>
    </>
  );
};
