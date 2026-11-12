import { getCurrentUserName } from '#app/lib/currentUser';
import {
  getResearchStudyHeader,
  isResearchLibraryOwner,
} from '#app/lib/researchLibrary';
import { parseStudyKey } from '#app/lib/researchStudyLinks';
import { BacktestRunsPage } from './BacktestRunsPage';

export default async function BacktestPage({
  searchParams,
}: {
  searchParams: Promise<{ study?: string | string[]; new?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUserName();
  const researchAvailable = isResearchLibraryOwner(user);
  const ref =
    researchAvailable && typeof params.study === 'string'
      ? parseStudyKey(params.study)
      : null;
  const study = ref ? await getResearchStudyHeader(ref.strategy, ref.id) : null;

  return (
    <BacktestRunsPage
      key={
        study ? `${study.strategy}/${study.id}:${params.new ?? ''}` : 'all-runs'
      }
      study={study}
      studyUnavailable={params.study !== undefined && !study}
      openForm={params.new === '1' && Boolean(study)}
      researchAvailable={researchAvailable}
    />
  );
}
