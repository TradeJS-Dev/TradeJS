import { v4 as uuidv4 } from 'uuid';

export const uuid = (len: number = 12) => {
  const uuid = uuidv4();
  return uuid.slice(-len);
};
