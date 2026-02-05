import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getData, redisKeys } from '@utils/redis';

const getPasswordHash = (user: unknown): string | null => {
  if (!user) return null;
  if (typeof user === 'string') return user;
  if (typeof user !== 'object') return null;

  const record = user as Record<string, unknown>;
  const direct = record.passwordHash ?? record.password;
  if (typeof direct === 'string') return direct;

  const nested = record.password as Record<string, unknown> | undefined;
  const nestedHash = nested?.hash;
  if (typeof nestedHash === 'string') return nestedHash;

  const alt = record.hash;
  if (typeof alt === 'string') return alt;

  return null;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        const username = credentials?.username?.toString().trim();
        const password = credentials?.password?.toString();

        if (!username || !password) return null;

        const user = await getData(redisKeys.user(username), null);
        const passwordHash = getPasswordHash(user);
        if (!passwordHash) return null;

        const isValid = await bcrypt.compare(password, passwordHash);
        if (!isValid) return null;

        return { id: username, name: username };
      },
    }),
  ],
  pages: {
    signIn: '/routes/signin',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    authorized: ({ auth: session }) => Boolean(session?.user),
    jwt: ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.name = user.name;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (token?.id) {
        session.user = {
          ...session.user,
          id: String(token.id),
        };
      }
      return session;
    },
  },
});
