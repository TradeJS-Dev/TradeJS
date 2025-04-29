'use client';

import React from 'react';
import { SelectSymbol } from './Filters/Symbol';
import { MainChart } from './MainChart';

export const Dashboard = () => {
  return (
    <>
      <div className="p-2">
        <SelectSymbol />
      </div>
      <div className="flex-1 w-full">
        <MainChart />
      </div>
    </>
  );
};
