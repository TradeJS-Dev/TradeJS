export const updateUrlSearchParams = (
  changes: Record<string, string | null | undefined>,
) => {
  const url = new URL(window.location.href);

  for (const [key, value] of Object.entries(changes)) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }

  if (url.href !== window.location.href) {
    window.history.replaceState(null, '', url);
  }
};
