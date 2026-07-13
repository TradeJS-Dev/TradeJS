const getStringField = (value: unknown, key: string) => {
  if (!value || typeof value !== 'object') return null;

  const field = (value as Record<string, unknown>)[key];
  if (typeof field === 'string' && field.trim()) return field.trim();
  if (key === 'code' && typeof field === 'number') return String(field);
  return null;
};

export const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  const code = getStringField(error, 'code');
  const message = getStringField(error, 'message');
  const body = getStringField(error, 'body');
  const details = [code, message].filter(Boolean).join(' ');

  if (details || body) {
    return [details, body].filter(Boolean).join(': ');
  }

  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== '{}' ? serialized : 'Unknown error';
  } catch {
    return 'Unknown error';
  }
};
