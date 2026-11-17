const fallback = '/routes/dashboard';

export const safeCallbackUrl = (value: string | null, origin: string) => {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, origin);
    if (
      url.pathname.startsWith('//') ||
      url.origin !== origin ||
      !['http:', 'https:'].includes(url.protocol)
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
};
