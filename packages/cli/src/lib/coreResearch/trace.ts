import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import type { CoreResearchTraceEvent } from '@tradejs/types';

export const summarizeCoreResearchTrace = async (filePaths: string[] = []) => {
  const events: Record<string, number> = Object.create(null);
  const skipCounts: Record<string, number> = Object.create(null);
  const exitCodes: Record<string, number> = Object.create(null);
  const policyRejections: Record<string, number> = {};
  const policyExamples: Array<{
    timestamp: number;
    symbol: string;
    decision: NonNullable<
      Extract<
        CoreResearchTraceEvent,
        { event: 'signal_emitted' | 'entry_rejected' | 'entry_executed' }
      >['researchEntryDecision']
    >;
  }> = [];
  for (const inputPath of filePaths) {
    const filePath = path.resolve(inputPath);
    const input = createReadStream(filePath);
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let index = -1;
    try {
      for await (const line of lines) {
        index++;
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
        if (event.event === 'position_exited' && event.exitCode) {
          exitCodes[event.exitCode] = (exitCodes[event.exitCode] ?? 0) + 1;
        }
        if (
          'researchEntryDecision' in event &&
          event.researchEntryDecision &&
          !event.researchEntryDecision.allowed
        ) {
          const reason = event.researchEntryDecision.reason;
          policyRejections[reason] = (policyRejections[reason] ?? 0) + 1;
          if (policyExamples.length < 20)
            policyExamples.push({
              timestamp: event.timestamp,
              symbol: event.symbol,
              decision: event.researchEntryDecision,
            });
        }
      }
    } finally {
      lines.close();
      input.destroy();
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
    exitCodes: Object.fromEntries(
      Object.entries(exitCodes).sort(
        ([leftKey, leftValue], [rightKey, rightValue]) =>
          rightValue - leftValue ||
          (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
      ),
    ),
    ...(policyExamples.length
      ? {
          researchPolicy: {
            rejections: policyRejections,
            examples: policyExamples,
          },
        }
      : {}),
  };
};
