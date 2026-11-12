import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { decodeResearchMetricSnapshot } from '@tradejs/infra/researchMetricSnapshot';
import { INSTALL_USER_NAME } from './installation';
import type {
  ResearchArtifact,
  ResearchChart,
  ResearchStudy,
  ResearchStudyDetail,
} from './researchLibraryTypes';

const NOTE_PREFIX_BYTES = 16 * 1024;
const MAX_NOTE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const ARTIFACT_ROOTS = [
  'data/research',
  'data/strategy-release',
  'data/ai/output',
  'output',
];
const ARTIFACT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
} as const;
const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const STUDY_ID = /^\d{4}-\d{2}-\d{2}-[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const DISPLAY_SECTIONS = new Set([
  'Research question',
  'Decision',
  'Reported metrics',
  'Findings',
  'Limitations and next step',
]);
const SNAPSHOT_SECTION = 'Metrics snapshot (machine-readable)';
const SECTION_BOUNDARIES = new Set([
  ...DISPLAY_SECTIONS,
  'Reproduction manifest',
  'Resolved configuration',
  SNAPSHOT_SECTION,
  'Artifact inventory',
]);

export const isResearchLibraryOwner = (userName: string | null) =>
  userName === INSTALL_USER_NAME;

const projectRoot = () =>
  path.resolve(process.env.PROJECT_CWD?.trim() || process.cwd());
const isInside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const missing = (error: unknown) =>
  ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(
    (error as NodeJS.ErrnoException)?.code ?? '',
  );

const directory = async (root: string) => {
  try {
    return await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
};

const parseStudy = (
  strategy: string,
  id: string,
  text: string,
): ResearchStudy | null => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!frontmatter) return null;
  const fields = new Map(
    frontmatter[1].split(/\r?\n/).flatMap((line): [string, string][] => {
      const entry = /^(\w+):\s*(.*?)\s*$/.exec(line);
      return entry
        ? [[entry[1], entry[2].replace(/^(['"])(.*)\1$/, '$2')]]
        : [];
    }),
  );
  const schema = fields.get('schema');
  if (schema !== 'tradejs-research/v1' && schema !== 'tradejs-research/v2')
    return null;
  return {
    strategy,
    id,
    title:
      /^#\s+(.+)$/m.exec(text.slice(frontmatter[0].length))?.[1].trim() ?? id,
    date: fields.get('date') ?? id.slice(0, 10),
    kind: fields.get('kind') ?? '',
    status: fields.get('status') ?? '',
  };
};

const readNoteHeader = async (file: string) => {
  try {
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) return null;
      const buffer = Buffer.alloc(Math.min(info.size, NOTE_PREFIX_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return { text: buffer.toString('utf8', 0, bytesRead), size: info.size };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
};

export const listResearchStudies = async () => {
  const root = await realpath(projectRoot());
  const notes = path.join(root, 'notes');
  const notesPath = await realpath(notes).catch((error) => {
    if (missing(error)) return null;
    throw error;
  });
  if (notesPath !== notes) return [];
  const groups = await directory(notes);
  const studies: ResearchStudy[] = [];
  for (const group of groups) {
    if (!group.isDirectory() || !SEGMENT.test(group.name)) continue;
    const files = await directory(path.join(notes, group.name));
    const entries = files.filter(
      (file) =>
        file.isFile() &&
        file.name.endsWith('.md') &&
        STUDY_ID.test(file.name.slice(0, -3)),
    );
    for (let offset = 0; offset < entries.length; offset += 24) {
      const batch = await Promise.all(
        entries.slice(offset, offset + 24).map(async (file) => {
          const header = await readNoteHeader(
            path.join(notes, group.name, file.name),
          );
          return (
            header &&
            parseStudy(group.name, file.name.slice(0, -3), header.text)
          );
        }),
      );
      for (const study of batch) if (study) studies.push(study);
    }
  }
  return studies.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.title.localeCompare(right.title),
  );
};

async function* noteLines(file: string, lineLimit: number) {
  let pending = '';
  let skipLine = false;
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    const lines = String(chunk).split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!skipLine && pending.length + line.length <= lineLimit) {
        pending += line;
      } else {
        pending = '';
        skipLine = true;
      }
      if (index < lines.length - 1) {
        yield pending.replace(/\r$/, '');
        pending = '';
        skipLine = false;
      }
    }
  }
  if (pending) yield pending.replace(/\r$/, '');
}

const getSections = async (file: string, includeSnapshot: boolean) => {
  const sections: { title: string; text: string }[] = [];
  let current: { title: string; lines: string[] } | undefined;
  let fence: string | undefined;
  for await (const line of noteLines(
    file,
    includeSnapshot ? MAX_NOTE_BYTES : 64 * 1024,
  )) {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter[0];
      else if (delimiter[0] === fence) fence = undefined;
    }
    const title = !fence && /^##\s+(.+?)\s*$/.exec(line)?.[1];
    if (title && SECTION_BOUNDARIES.has(title)) {
      if (current)
        sections.push({
          title: current.title,
          text: current.lines.join('\n').trim(),
        });
      current =
        DISPLAY_SECTIONS.has(title) ||
        title === 'Artifact inventory' ||
        (includeSnapshot && title === SNAPSHOT_SECTION)
          ? { title, lines: [] }
          : undefined;
    } else {
      current?.lines.push(line);
    }
  }
  if (current)
    sections.push({
      title: current.title,
      text: current.lines.join('\n').trim(),
    });
  return sections;
};

const loadResearchNote = async (strategy: string, id: string) => {
  if (!SEGMENT.test(strategy) || !STUDY_ID.test(id)) return null;
  const root = await realpath(projectRoot());
  try {
    const file = await realpath(path.join(root, 'notes', strategy, `${id}.md`));
    if (!isInside(path.join(root, 'notes', strategy), file)) return null;
    const header = await readNoteHeader(file);
    if (!header) return null;
    const study = parseStudy(strategy, id, header.text);
    return study
      ? {
          root,
          file,
          study,
          sections: await getSections(file, header.size <= MAX_NOTE_BYTES),
        }
      : null;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
};

const resolveArtifact = async (
  root: string,
  note: string,
  reference: string,
) => {
  let target: string;
  try {
    target = decodeURIComponent(reference);
  } catch {
    return null;
  }
  if (/^[\w+.-]+:|^\/\//.test(target)) return null;
  const base = /^(data|output)\//.test(target) ? root : path.dirname(note);
  const candidate = path.resolve(base, target);
  const allowed = (file: string) =>
    ARTIFACT_ROOTS.some((dir) => isInside(path.join(root, dir), file));
  if (!allowed(candidate)) return null;
  try {
    const file = await realpath(candidate);
    if (!allowed(file)) return null;
    const extension = path.extname(file).toLowerCase();
    if (!Object.hasOwn(ARTIFACT_TYPES, extension)) return null;
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_ARTIFACT_BYTES) return null;
    return {
      file,
      contentType: ARTIFACT_TYPES[extension as keyof typeof ARTIFACT_TYPES],
    };
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
};

const findResearchArtifacts = async (
  note: NonNullable<Awaited<ReturnType<typeof loadResearchNote>>>,
) => {
  const references = new Map<string, string>();
  for (const section of note.sections) {
    if (
      section.title !== 'Artifact inventory' &&
      !DISPLAY_SECTIONS.has(section.title)
    )
      continue;
    for (const link of section.text.matchAll(
      /\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/g,
    )) {
      if (/\.(png|jpe?g|webp|svg|html)$/i.test(link[2]))
        references.set(link[2], link[1]);
    }
    if (section.title !== 'Artifact inventory') continue;
    for (const match of section.text.matchAll(
      /"path"\s*:\s*("(?:[^"\\]|\\.)*\.(?:html|png|jpe?g|webp|svg)")/gi,
    )) {
      try {
        const reference: string = JSON.parse(match[1]);
        if (!references.has(reference))
          references.set(reference, path.basename(reference));
      } catch {
        // A malformed reference should not hide the other study materials.
      }
    }
    for (const match of section.text.matchAll(
      /(?:^|[\s`])((?:\/|\.\.\/|data\/|output\/)[^\s`()[\]]+\.(?:html|png|jpe?g|webp|svg))(?=$|[\s`),;])/gim,
    )) {
      if (!references.has(match[1]))
        references.set(match[1], path.basename(match[1]));
    }
  }
  const artifacts = new Map<
    string,
    ResearchArtifact & { file: string; contentType: string }
  >();
  for (const [reference, label] of references) {
    const resolved = await resolveArtifact(note.root, note.file, reference);
    if (!resolved) continue;
    const id = createHash('sha256')
      .update(path.relative(note.root, resolved.file))
      .digest('hex')
      .slice(0, 24);
    artifacts.set(id, {
      id,
      label,
      kind: resolved.contentType.startsWith('image/') ? 'chart' : 'report',
      ...resolved,
    });
  }
  // PNG and SVG exports with the same stem represent the same chart.
  return [...artifacts.values()].filter(
    ({ file }) =>
      path.extname(file) !== '.svg' ||
      ![...artifacts.values()].some(
        (item) => item.file === file.replace(/\.svg$/, '.png'),
      ),
  );
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const readChart = (section: string | undefined): ResearchChart | null => {
  const payload = section && /```json\s*([\s\S]*?)\s*```/.exec(section)?.[1];
  if (!payload) return null;
  try {
    const envelope = record(JSON.parse(payload));
    if (
      envelope?.encoding === 'gzip+base64' &&
      (!finite(envelope.decodedBytes) ||
        envelope.decodedBytes > 32 * 1024 * 1024)
    )
      return null;
    const snapshot =
      envelope?.encoding === 'gzip+base64'
        ? record(decodeResearchMetricSnapshot(envelope))
        : envelope;
    const chart = record(snapshot?.chart) ?? snapshot;
    const window = record(chart?.window);
    if (
      chart?.schema !== 'tradejs-research-comparison-chart/v1' ||
      !finite(window?.start) ||
      !finite(window?.end) ||
      window.end <= window.start ||
      !Array.isArray(chart.series)
    )
      return null;
    const { start, end } = window;
    const series = chart.series.flatMap((value: unknown) => {
      const line = record(value);
      if (!line || typeof line.label !== 'string') return [];
      const fromTrades =
        !Array.isArray(line.equity) && Array.isArray(line.trades);
      const source = fromTrades ? line.trades : line.equity;
      if (!Array.isArray(source) || source.length > 30_000) return [];
      const points = source
        .filter(
          (point): point is [number, number] =>
            Array.isArray(point) &&
            finite(point[0]) &&
            finite(point[1]) &&
            point[0] >= start &&
            point[0] <= end,
        )
        .sort((left, right) => left[0] - right[0]);
      if (!points.length && line.equityStatus !== 'verified-empty') return [];
      if (!fromTrades && points.length) return [{ label: line.label, points }];
      let cumulative = 0;
      const equity: [number, number][] = [[start, 0]];
      for (const [timestamp, pnl] of points) {
        cumulative += pnl;
        equity.push([timestamp, cumulative]);
      }
      if (equity.at(-1)?.[0] !== end) equity.push([end, cumulative]);
      return [{ label: line.label, points: equity }];
    });
    return series.length
      ? {
          title:
            typeof chart.title === 'string' ? chart.title : 'Cumulative P&L',
          unit: typeof chart.pnlUnit === 'string' ? chart.pnlUnit : '',
          start: window.start,
          end: window.end,
          series,
        }
      : null;
  } catch {
    return null;
  }
};

export const getResearchStudy = async (
  strategy: string,
  id: string,
): Promise<ResearchStudyDetail | null> => {
  const note = await loadResearchNote(strategy, id);
  if (!note) return null;
  const artifacts = await findResearchArtifacts(note);
  return {
    ...note.study,
    sections: note.sections.filter(
      (section) => DISPLAY_SECTIONS.has(section.title) && section.text,
    ),
    artifacts: artifacts.map(({ id: artifactId, label, kind }) => ({
      id: artifactId,
      label,
      kind,
    })),
    chart: artifacts.some(({ kind }) => kind === 'chart')
      ? null
      : readChart(
          note.sections.find(({ title }) => title === SNAPSHOT_SECTION)?.text,
        ),
  };
};

export const getResearchArtifact = async (
  strategy: string,
  id: string,
  artifactId: string,
) => {
  if (!/^[a-f0-9]{24}$/.test(artifactId)) return null;
  const note = await loadResearchNote(strategy, id);
  if (!note) return null;
  return (
    (await findResearchArtifacts(note)).find(
      (artifact) => artifact.id === artifactId,
    ) ?? null
  );
};
