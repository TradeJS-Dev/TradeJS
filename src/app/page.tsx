'use client';

import { KlineChart } from '@components/KlineChart';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-start justify-between p-12 bg-zinc-900">
      <KlineChart />
    </main>
  );
}
