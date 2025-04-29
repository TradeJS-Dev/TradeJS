'use client';

import { Dashboard } from '@components/Dashboard';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-start justify-between p-12 bg-zinc-900">
      <Dashboard />
    </main>
  );
}
