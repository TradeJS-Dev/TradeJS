import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getCurrentUserName } from '#app/lib/currentUser';
import { isResearchLibraryOwner } from '#app/lib/researchLibrary';
import { ResearchLibrary } from './ResearchLibrary';

export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  if (!isResearchLibraryOwner(await getCurrentUserName())) notFound();

  return (
    <Suspense>
      <ResearchLibrary />
    </Suspense>
  );
}
