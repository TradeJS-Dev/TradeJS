import { getResearchStudy, listResearchStudies } from '../researchLibrary';

export const readMcpResearchStudies = async ({
  strategy,
  offset,
  limit,
}: {
  strategy?: string;
  offset: number;
  limit: number;
}) => {
  const studies = await listResearchStudies(strategy);
  const items = [];
  let bytes = 0;
  for (const study of studies.slice(offset, offset + limit)) {
    const size = Buffer.byteLength(JSON.stringify(study));
    if (items.length && bytes + size > 96000) break;
    bytes += size;
    items.push(study);
  }
  const next = offset + items.length;
  return { items, nextOffset: next < studies.length ? next : null };
};

const sectionPage = (
  title: string,
  text: string,
  offset: number,
  limit: number,
) => {
  let end = Math.min(text.length, offset + limit);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  return {
    title,
    text: text.slice(offset, end),
    nextOffset: end < text.length ? end : null,
  };
};

export const readMcpResearchStudy = async ({
  strategy,
  studyId,
  section,
  offset,
}: {
  strategy: string;
  studyId: string;
  section?: string;
  offset: number;
}) => {
  const study = await getResearchStudy(strategy, studyId, {
    includeChart: false,
  });
  if (!study) throw new Error('Select a study from research_list_studies');
  const { chart: _chart, sections, ...summary } = study;
  if (section !== undefined) {
    const row = sections.find(({ title }) => title === section);
    if (!row)
      throw new Error('Select a section title returned by research_get_study');
    return {
      ...summary,
      sections: [sectionPage(row.title, row.text, offset, 8000)],
    };
  }
  if (offset !== 0) throw new Error('Select a section before using offset');
  return {
    ...summary,
    sections: sections.map(({ title, text }) =>
      sectionPage(title, text, 0, 2000),
    ),
  };
};
