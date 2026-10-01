import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { JevProviderConfig, JevResponse } from '@tradejs/types';

export const jevStableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(jevStableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${jevStableJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
export const jevHash = (value: unknown) =>
  createHash('sha256').update(jevStableJson(value)).digest('hex');
export const jevFileHash = (contents: string) =>
  createHash('sha256').update(contents).digest('hex');

/** Writes once. Concurrent callers keep the first complete record. */
export const writeJevArtifact = async (file: string, value: unknown) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(
    temp,
    JSON.stringify({ checksum: jevHash(value), value }),
    { mode: 0o600, flag: 'wx' },
  );
  try {
    await fs.link(temp, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    await fs.unlink(temp);
  }
};

export const readJevArtifact = async <T>(file: string): Promise<T | null> => {
  let contents: string;
  try {
    contents = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const envelope = JSON.parse(contents);
  if (!envelope || envelope.checksum !== jevHash(envelope.value))
    throw new Error('Jev artifact checksum mismatch');
  return envelope.value as T;
};

export const requestJev = async (
  provider: JevProviderConfig,
  apiKey: string,
  state: unknown,
  questions: unknown,
  options: { fetch?: typeof fetch; timeoutMs?: number; retries?: number } = {},
): Promise<JevResponse> => {
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetcher(provider.endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://tradejs.dev',
            'X-Title': 'TradeJS Jev',
          },
          body: JSON.stringify({ model: provider.model, state, questions }),
        });
      } catch {
        throw new Error(
          controller.signal.aborted
            ? 'Jev request timed out'
            : 'Jev provider connection failed',
        );
      }
      if (!response.ok) {
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < (options.retries ?? 2) &&
          !controller.signal.aborted
        ) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = Number(retryAfter);
          const delay =
            retryAfter && !Number.isFinite(seconds)
              ? Date.parse(retryAfter) - Date.now()
              : (seconds || 0.25 * 2 ** attempt) * 1000;
          if (delay >= timeoutMs)
            throw new Error('Jev rate limit exceeds request deadline');
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              clearTimeout(wait);
              reject(new Error('Jev request timed out'));
            };
            const wait = setTimeout(
              () => {
                controller.signal.removeEventListener('abort', onAbort);
                resolve();
              },
              Math.max(0, delay),
            );
            controller.signal.addEventListener('abort', onAbort, {
              once: true,
            });
          });
          continue;
        }
        // Provider bodies may echo credentials or the private state.
        throw new Error(`Jev provider HTTP ${response.status}`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('Jev provider returned invalid JSON');
      }
      return validateJevResponse(body, Object.keys(questions as object));
    }
  } finally {
    clearTimeout(timer);
  }
};

export const validateJevResponse = (
  body: unknown,
  expected: string[],
): JevResponse => {
  const result = body as JevResponse;
  if (
    !result ||
    typeof result.model !== 'string' ||
    !result.model ||
    !result.answers
  )
    throw new Error('Invalid Jev response');
  if (
    !expected.length ||
    expected.length > 8 ||
    Object.keys(result.answers).sort().join(',') !==
      [...expected].sort().join(',')
  )
    throw new Error('Invalid Jev answer set');
  for (const key of expected) {
    const answer = result.answers[key as keyof JevResponse['answers']];
    if (
      !answer ||
      answer.type !== 'score' ||
      !Number.isFinite(answer.score) ||
      answer.score < 0 ||
      answer.score > 4 ||
      !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 ||
      answer.confidence > 1
    )
      throw new Error(`Invalid Jev ${key} answer`);
    const probabilities = answer.probabilities;
    if (
      !probabilities ||
      Object.keys(probabilities).length !== 5 ||
      [0, 1, 2, 3, 4].some(
        (level) =>
          !Number.isFinite(probabilities[level]) ||
          probabilities[level] < 0 ||
          probabilities[level] > 1,
      )
    )
      throw new Error(`Invalid Jev ${key} probabilities`);
    // The Decisions API rounds each probability and the score to two decimals.
    // Account for independent rounding, while retaining the original response.
    const roundingHalfUnit = 0.005;
    const epsilon = 1e-9;
    if (
      Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) >
      5 * roundingHalfUnit + epsilon
    )
      throw new Error('Jev probabilities must sum to one');
    const mean = [0, 1, 2, 3, 4].reduce(
      (sum, level) => sum + level * probabilities[level],
      0,
    );
    if (
      Math.abs(mean - answer.score) >
      (0 + 1 + 2 + 3 + 4 + 1) * roundingHalfUnit + epsilon
    )
      throw new Error('Jev score disagrees with probabilities');
  }
  return result;
};
