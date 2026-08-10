#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(
  String(process.env.PROJECT_CWD || process.cwd()),
);
const notesRoot = path.join(projectRoot, 'notes');
const filenamePattern = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const requiredFrontmatter = [
  'schema',
  'strategy',
  'date',
  'kind',
  'status',
  'reproduction',
];
const completeSections = [
  '## Research question',
  '## Decision',
  '## Reproduction manifest',
  '## Resolved configuration',
  '## Metrics snapshot (machine-readable)',
  '## Reported metrics',
  '## Findings',
  '## Artifact inventory',
  '## Limitations and next step',
];

const parseFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;

  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.match(/^([a-z0-9_]+):\s*(.*)$/))
      .filter(Boolean)
      .map((entry) => {
        const value = entry[2].trim();
        return [
          entry[1],
          value.startsWith('"') ? JSON.parse(value) : value,
        ];
      }),
  );
};

const errors = [];
let records = 0;
const rootEntries = await fs.readdir(notesRoot, { withFileTypes: true });

for (const entry of rootEntries) {
  if (!entry.isDirectory()) {
    errors.push(`notes/${entry.name}: files are not allowed directly in notes/`);
    continue;
  }

  const directoryPath = path.join(notesRoot, entry.name);
  const noteEntries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const noteEntry of noteEntries) {
    const relativePath = path.join('notes', entry.name, noteEntry.name);
    if (!noteEntry.isFile() || !noteEntry.name.endsWith('.md')) {
      errors.push(`${relativePath}: only Markdown research files are allowed`);
      continue;
    }

    records += 1;
    if (!filenamePattern.test(noteEntry.name)) {
      errors.push(`${relativePath}: expected YYYY-MM-DD-<kebab-slug>.md`);
    }

    const content = await fs.readFile(path.join(directoryPath, noteEntry.name), 'utf8');
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
      errors.push(`${relativePath}: missing YAML frontmatter`);
      continue;
    }

    for (const key of requiredFrontmatter) {
      if (!frontmatter[key]) errors.push(`${relativePath}: missing ${key}`);
    }
    if (frontmatter.schema !== 'tradejs-research/v1') {
      errors.push(`${relativePath}: unsupported schema ${frontmatter.schema}`);
    }
    if (frontmatter.strategy !== entry.name) {
      errors.push(
        `${relativePath}: strategy ${frontmatter.strategy} must match directory ${entry.name}`,
      );
    }
    if (frontmatter.date !== noteEntry.name.slice(0, 10)) {
      errors.push(`${relativePath}: date must match the filename`);
    }

    let previousIndex = -1;
    for (const section of completeSections) {
      const sectionIndex = content.indexOf(section);
      if (sectionIndex === -1) {
        errors.push(`${relativePath}: missing ${section}`);
      } else if (sectionIndex < previousIndex) {
        errors.push(`${relativePath}: ${section} is out of order`);
      }
      previousIndex = Math.max(previousIndex, sectionIndex);
    }

    if (frontmatter.reproduction === 'complete') {
      const snapshotStart = content.indexOf(
        '## Metrics snapshot (machine-readable)',
      );
      const reportedStart = content.indexOf('## Reported metrics');
      const snapshot = content.slice(snapshotStart, reportedStart);
      if (!/```json\n[\s\S]+?\n```/.test(snapshot)) {
        errors.push(`${relativePath}: complete record needs a JSON metric snapshot`);
      }
    }
  }
}

if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${records} research note records.\n`);
}
