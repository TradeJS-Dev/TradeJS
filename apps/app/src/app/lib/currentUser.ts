import { auth } from '#app/auth';

type SessionLike = {
  user?: {
    id?: string;
    name?: string | null;
  };
} | null;

const readSessionUserName = (session: SessionLike) => {
  const fromId = session?.user?.id;
  if (typeof fromId === 'string' && fromId.trim()) {
    return fromId.trim();
  }

  const fromName = session?.user?.name;
  if (typeof fromName === 'string' && fromName.trim()) {
    return fromName.trim();
  }

  return null;
};

export const getCurrentUserName = async (): Promise<string | null> => {
  const session = (await auth()) as SessionLike;
  return readSessionUserName(session);
};
