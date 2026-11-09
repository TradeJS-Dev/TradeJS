#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  decodeMetricSnapshot,
  validatePermanentMetrics,
} from './metric-snapshot.mjs';

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
          value.startsWith('"')
            ? JSON.parse(value)
            : value.startsWith("'") && value.endsWith("'")
              ? value.slice(1, -1).replaceAll("''", "'")
              : value,
        ];
      }),
  );
};

const errors = [];
let records = 0;
const rootEntries = await fs
  .readdir(notesRoot, { withFileTypes: true })
  .catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });

for (const entry of rootEntries) {
  if (!entry.isDirectory()) {
    errors.push(
      `notes/${entry.name}: files are not allowed directly in notes/`,
    );
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

    const content = await fs.readFile(
      path.join(directoryPath, noteEntry.name),
      'utf8',
    );
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
      errors.push(`${relativePath}: missing YAML frontmatter`);
      continue;
    }

    for (const key of requiredFrontmatter) {
      if (!frontmatter[key]) errors.push(`${relativePath}: missing ${key}`);
    }
    if (
      !['tradejs-research/v1', 'tradejs-research/v2'].includes(
        frontmatter.schema,
      )
    ) {
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

    // Preserve the existing Project contract for historical incomplete records.
    if (
      frontmatter.schema === 'tradejs-research/v1' &&
      frontmatter.reproduction !== 'complete'
    )
      continue;

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

    if (frontmatter.schema === 'tradejs-research/v2') {
      if (Buffer.byteLength(content) > 8 * 1024 * 1024)
        errors.push(
          `${relativePath}: compact note exceeds 8 MiB; archive source separately, never truncate metrics`,
        );
      for (const block of content.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)) {
        try {
          const value = JSON.parse(block[1]);
          if (value?.schema === 'tradejs-metric-snapshot/v1')
            decodeMetricSnapshot(value);
          else validatePermanentMetrics(value);
        } catch (error) {
          errors.push(
            `${relativePath}: invalid compact JSON: ${error.message}`,
          );
        }
      }
    }

    if (frontmatter.reproduction === 'complete') {
      const snapshotStart = content.indexOf(
        '## Metrics snapshot (machine-readable)',
      );
      const reportedStart = content.indexOf('## Reported metrics');
      const snapshot = content.slice(snapshotStart, reportedStart);
      if (!/```json\n[\s\S]+?\n```/.test(snapshot)) {
        errors.push(
          `${relativePath}: complete record needs a JSON metric snapshot`,
        );
      }
      if (frontmatter.schema === 'tradejs-research/v2') {
        const blocks = [
          ...snapshot.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g),
        ];
        try {
          if (blocks.length !== 1)
            throw new Error('use one snapshot containing all reports');
          decodeMetricSnapshot(JSON.parse(blocks[0][1]));
        } catch (error) {
          errors.push(
            `${relativePath}: complete v2 record needs one verified compact metric snapshot: ${error.message}`,
          );
        }
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
