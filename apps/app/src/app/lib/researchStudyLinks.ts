import type { ResearchStudy } from './researchLibraryTypes';

export const studyKey = ({
  strategy,
  id,
}: Pick<ResearchStudy, 'strategy' | 'id'>) => `${strategy}/${id}`;

export const parseStudyKey = (value: string) => {
  const match =
    /^([a-zA-Z0-9][a-zA-Z0-9_.-]{0,127})\/(\d{4}-\d{2}-\d{2}-[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127})$/.exec(
      value,
    );
  return match ? { strategy: match[1], id: match[2] } : null;
};

export function studyUrl(strategy?: string, study?: string) {
  const query = new URLSearchParams();
  if (strategy) query.set('strategy', strategy);
  if (study) query.set('study', study);
  return query.size ? `/routes/research?${query}` : '/routes/research';
}

export function studyBacktestsUrl(study: string, launch = false) {
  const query = new URLSearchParams({ study });
  if (launch) query.set('new', '1');
  return `/routes/backtest?${query}`;
}
