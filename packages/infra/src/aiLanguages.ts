export type AiResponseLanguageOption = {
  label: string;
  value: string;
  promptName: string;
};

export const AI_RESPONSE_LANGUAGE_OPTIONS: AiResponseLanguageOption[] = [
  { label: 'English', value: 'en', promptName: 'English' },
  { label: 'Chinese', value: 'zh', promptName: 'Chinese' },
  { label: 'Hindi', value: 'hi', promptName: 'Hindi' },
  { label: 'Spanish', value: 'es', promptName: 'Spanish' },
  { label: 'French', value: 'fr', promptName: 'French' },
  { label: 'Arabic', value: 'ar', promptName: 'Arabic' },
  { label: 'Bengali', value: 'bn', promptName: 'Bengali' },
  { label: 'Portuguese', value: 'pt', promptName: 'Portuguese' },
  { label: 'Russian', value: 'ru', promptName: 'Russian' },
  { label: 'Urdu', value: 'ur', promptName: 'Urdu' },
  { label: 'Indonesian', value: 'id', promptName: 'Indonesian' },
  { label: 'German', value: 'de', promptName: 'German' },
  { label: 'Japanese', value: 'ja', promptName: 'Japanese' },
  { label: 'Swahili', value: 'sw', promptName: 'Swahili' },
  { label: 'Marathi', value: 'mr', promptName: 'Marathi' },
  { label: 'Telugu', value: 'te', promptName: 'Telugu' },
  { label: 'Turkish', value: 'tr', promptName: 'Turkish' },
  { label: 'Tamil', value: 'ta', promptName: 'Tamil' },
  { label: 'Vietnamese', value: 'vi', promptName: 'Vietnamese' },
  { label: 'Korean', value: 'ko', promptName: 'Korean' },
];

const KNOWN_AI_RESPONSE_LANGUAGES = new Set(
  AI_RESPONSE_LANGUAGE_OPTIONS.map((option) => option.value),
);

export const DEFAULT_AI_RESPONSE_LANGUAGE =
  AI_RESPONSE_LANGUAGE_OPTIONS[0].value;

export const normalizeAiResponseLanguage = (value: unknown): string => {
  if (typeof value !== 'string') {
    return DEFAULT_AI_RESPONSE_LANGUAGE;
  }

  const trimmed = value.trim().toLowerCase();
  return KNOWN_AI_RESPONSE_LANGUAGES.has(trimmed)
    ? trimmed
    : DEFAULT_AI_RESPONSE_LANGUAGE;
};

export const getAiResponseLanguagePromptName = (value: unknown): string =>
  AI_RESPONSE_LANGUAGE_OPTIONS.find(
    (option) => option.value === normalizeAiResponseLanguage(value),
  )?.promptName ?? AI_RESPONSE_LANGUAGE_OPTIONS[0].promptName;
