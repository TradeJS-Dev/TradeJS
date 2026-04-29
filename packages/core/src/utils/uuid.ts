import { randomUUID } from 'node:crypto';

export const uuid = (len: number = 12) => {
  const uuid = randomUUID();
  return uuid.slice(-len);
};
