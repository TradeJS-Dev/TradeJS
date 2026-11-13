import { notFound } from 'next/navigation';
import { getCurrentUserName } from '#app/lib/currentUser';
import { INSTALL_USER_NAME } from '#app/lib/installation';
import { StrategyDiagnosticsView } from './StrategyDiagnosticsView';

export const dynamic = 'force-dynamic';

export default async function StrategyDiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; case?: string }>;
}) {
  if ((await getCurrentUserName()) !== INSTALL_USER_NAME) notFound();
  const params = await searchParams;
  const report =
    typeof params.report === 'string' && /^[a-f0-9]{64}$/.test(params.report)
      ? params.report
      : undefined;
  const caseId =
    report &&
    typeof params.case === 'string' &&
    /^[a-f0-9]{24}$/.test(params.case)
      ? params.case
      : undefined;
  return (
    <StrategyDiagnosticsView initialReport={report} initialCase={caseId} />
  );
}
