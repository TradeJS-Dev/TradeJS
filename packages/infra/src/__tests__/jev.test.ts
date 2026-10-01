import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  requestJev,
  readJevArtifact,
  writeJevArtifact,
  validateJevResponse,
} from '../jev';

const response = () => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    ['structure', 'participation', 'timing', 'geometry'].map((key) => [
      key,
      {
        type: 'score',
        score: 3,
        confidence: 1,
        probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 },
      },
    ]),
  ),
});
const questions = ['structure', 'participation', 'timing', 'geometry'];

describe('Jev transport and artifacts', () => {
  it('accepts eight independent answers and rejects an oversized set', () => {
    const keys = Array.from({ length: 8 }, (_, index) => `question_${index}`);
    const answer = response().answers.structure;
    const eight = {
      model: 'jev-1.13.0',
      answers: Object.fromEntries(keys.map((key) => [key, answer])),
    };
    expect(validateJevResponse(eight, keys)).toBe(eight);
    expect(() =>
      validateJevResponse(
        {
          ...eight,
          answers: { ...eight.answers, question_8: answer },
        },
        [...keys, 'question_8'],
      ),
    ).toThrow('Invalid Jev answer set');
  });

  it.each([
    'https://openrouter.ai/api/alpha/decisions',
    'https://api.typesafe.ai/v1/systemone',
    'https://decisions.example/evaluate',
  ])('uses the decision protocol at %s', async (endpoint) => {
    const fetcher = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => response() });
    await expect(
      requestJev(
        { endpoint, model: 'pinned' },
        'secret',
        { a: 1 },
        Object.fromEntries(
          ['structure', 'participation', 'timing', 'geometry'].map((key) => [
            key,
            { type: 'score' },
          ]),
        ),
        { fetch: fetcher },
      ),
    ).resolves.toEqual(response());
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(endpoint);
    expect(JSON.parse(options.body)).toEqual({
      model: 'pinned',
      state: { a: 1 },
      questions: Object.fromEntries(
        ['structure', 'participation', 'timing', 'geometry'].map((key) => [
          key,
          { type: 'score' },
        ]),
      ),
    });
    expect(options.redirect).toBe('error');
  });

  it('does not echo provider errors containing secrets', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'secret private state',
    });
    await expect(
      requestJev(
        { endpoint: 'https://example.com', model: 'pinned' },
        'secret',
        {},
        {},
        { fetch: fetcher },
      ),
    ).rejects.toThrow('Jev provider HTTP 401');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries rate limits within the request deadline', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '0.001' }),
      })
      .mockResolvedValue({ ok: true, json: async () => response() });
    await requestJev(
      { endpoint: 'https://example.com', model: 'pinned' },
      'key',
      {},
      { structure: {}, participation: {}, timing: {}, geometry: {} },
      { fetch: fetcher },
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts stalled requests', async () => {
    const fetcher = jest.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    );
    await expect(
      requestJev(
        { endpoint: 'https://example.com', model: 'pinned' },
        'key',
        {},
        {},
        { fetch: fetcher as typeof fetch, timeoutMs: 5 },
      ),
    ).rejects.toThrow('timed out');
  });

  it('rejects missing and inconsistent probability distributions', () => {
    const value = response();
    value.answers.structure.score = 1;
    expect(() => validateJevResponse(value, questions)).toThrow('disagrees');
    delete (value.answers as Record<string, unknown>).timing;
    expect(() =>
      validateJevResponse({ ...value, answers: {} }, questions),
    ).toThrow('answer');
  });

  it('accepts rounded OpenRouter probabilities without changing teacher scores', () => {
    const value = response();
    // Captured from OpenRouter during the Flag 180-day integration run.
    value.answers.participation = {
      type: 'score',
      score: 2.86,
      confidence: 0.51,
      probabilities: { 0: 0.02, 1: 0.05, 2: 0.17, 3: 0.55, 4: 0.2 },
    };
    expect(() => validateJevResponse(value, questions)).not.toThrow();
    expect(validateJevResponse(value, questions)).toBe(value);
    // Five values rounded to two decimals can accumulate more than 0.01 error.
    value.answers.participation.probabilities = {
      0: 0.2,
      1: 0.2,
      2: 0.2,
      3: 0.19,
      4: 0.19,
    };
    value.answers.participation.score = 1.97;
    expect(() => validateJevResponse(value, questions)).not.toThrow();
    value.answers.participation.probabilities[0] = 0.16;
    expect(() => validateJevResponse(value, questions)).toThrow('sum to one');
  });

  it('keeps the first immutable complete artifact and detects corruption', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradejs-jev-test-'));
    const file = path.join(dir, 'record.json');
    try {
      expect(await readJevArtifact(file)).toBeNull();
      await writeJevArtifact(file, { value: 1 });
      await writeJevArtifact(file, { value: 2 });
      expect(await readJevArtifact(file)).toEqual({ value: 1 });
      await fs.writeFile(file, JSON.stringify({ checksum: 'bad', value: 2 }));
      await expect(readJevArtifact(file)).rejects.toThrow('checksum');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
