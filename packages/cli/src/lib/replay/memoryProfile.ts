import fs from 'node:fs';
import path from 'node:path';

/** Opt-in diagnostic data only. Does not collect input payloads or force GC. */
export const createReplayMemoryProfile = (
  file = process.env.TRADEJS_REPLAY_MEMORY_PROFILE,
) => {
  if (!file) return undefined;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (phase: string, counts: Record<string, number> = {}) => {
    fs.appendFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        observedAt: Date.now(),
        pid: process.pid,
        phase,
        counts,
        ...process.memoryUsage(),
        maxRssKiB: process.resourceUsage().maxRSS,
      }) + '\n',
    );
  };
};
