/** Bound allocations even when Content-Length is missing or untrusted. */
export const readMcpBody = async (request: Request, limit: number) => {
  if (Number(request.headers.get('content-length') || 0) > limit)
    throw new Error('Request too large');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error('Request too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
};
