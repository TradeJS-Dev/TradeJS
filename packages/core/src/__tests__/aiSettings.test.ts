import { normalizeAiEndpoint } from '../aiEndpoints';
import {
  DEFAULT_AI_RESPONSE_LANGUAGE,
  normalizeAiResponseLanguage,
} from '../aiLanguages';
import { normalizeAiModel } from '../aiModels';

describe('browser-safe AI settings policy', () => {
  it('accepts public HTTPS endpoints and rejects invalid or private URLs', () => {
    expect(normalizeAiEndpoint('https://api.continue.example/v1/')).toBe(
      'https://api.continue.example/v1',
    );
    expect(normalizeAiEndpoint('not-a-url')).toBe('');
    expect(normalizeAiEndpoint('https://localhost:11434/v1')).toBe('');
    expect(normalizeAiEndpoint('https://192.168.1.10/v1')).toBe('');
  });

  it('normalizes language and model defaults without Node dependencies', () => {
    expect(normalizeAiResponseLanguage('RU')).toBe('ru');
    expect(normalizeAiResponseLanguage('unknown')).toBe(
      DEFAULT_AI_RESPONSE_LANGUAGE,
    );
    expect(normalizeAiModel('', 'https://api.openai.com/v1')).toBe(
      'gpt-5-mini',
    );
  });
});
