import { notFound } from 'next/navigation';
import {
  getDataCoveragePeriodEnd,
  listDataCoverageDatasets,
} from '@tradejs/infra/timescale/dataCoverage';
import { getCurrentUserName } from '#app/lib/currentUser';
import { readSavedCoverageYear } from '#app/lib/dataCoverageCache';
import { INSTALL_USER_NAME } from '#app/lib/installation';
import { DataCoverageView } from './DataCoverageView';

export const dynamic = 'force-dynamic';

export default async function DataCoveragePage() {
  if ((await getCurrentUserName()) !== INSTALL_USER_NAME) notFound();

  const latest = getDataCoveragePeriodEnd();
  const initialCoverage = await readSavedCoverageYear(
    new Date(latest - 86_400_000).getUTCFullYear(),
  );
  return (
    <DataCoverageView
      datasets={listDataCoverageDatasets()}
      latest={latest}
      initialCoverage={initialCoverage}
    />
  );
}
