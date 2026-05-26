import { notFound } from 'next/navigation';
import StrategiesPageClient from '../StrategiesPageClient';

const MODES = new Set(['runtime', 'replay', 'ai']);

const StrategyModePage = async ({
  params,
}: {
  params: Promise<{ mode: string }>;
}) => {
  const { mode } = await params;

  if (!MODES.has(mode)) {
    notFound();
  }

  return <StrategiesPageClient />;
};

export default StrategyModePage;
