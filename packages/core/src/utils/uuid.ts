export type IdGenerator = (length?: number) => string;
type RandomUuid = () => string;

const randomUuid: RandomUuid = () => {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('crypto.randomUUID is not available in this runtime');
  }

  return globalThis.crypto.randomUUID();
};

export const createIdGenerator =
  (generateUuid: RandomUuid = randomUuid): IdGenerator =>
  (length = 12) =>
    generateUuid().slice(-length);

export const uuid = createIdGenerator();
