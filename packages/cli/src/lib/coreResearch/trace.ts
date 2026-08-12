import fs from 'node:fs/promises';
import path from 'node:path';
import type { CoreResearchTraceEvent } from '@tradejs/types';

export const summarizeCoreResearchTrace = async (filePaths: string[] = []) => {
  const events: Record<string, number> = {};
  const skipCounts: Record<string, number> = {};
  for (const inputPath of filePaths) {
    const filePath = path.resolve(inputPath);
    const text = await fs.readFile(filePath, 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      if (!line.trim()) continue;
      let event: CoreResearchTraceEvent;
      try {
        event = JSON.parse(line) as CoreResearchTraceEvent;
      } catch (error) {
        throw new Error(
          `${filePath}:${index + 1} contains invalid trace JSON: ${String(error)}`,
        );
      }
      events[event.event] = (events[event.event] ?? 0) + 1;
      if (event.event === 'skip_summary') {
        for (const [reason, count] of Object.entries(event.skipCounts)) {
          skipCounts[reason] = (skipCounts[reason] ?? 0) + count;
        }
      }
    }
  }
  return {
    events: Object.fromEntries(Object.entries(events).sort()),
    skipCounts: Object.fromEntries(
      Object.entries(skipCounts).sort(
        ([leftKey, leftValue], [rightKey, rightValue]) =>
          rightValue - leftValue ||
          (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
      ),
    ),
  };
};
