import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getDataStrict, redisKeys } from '@tradejs/infra/redis';
import { getPasswordHash } from '#app/lib/installation';
import { readTwoFactor, verifyTwoFactor } from '#app/lib/twoFactor';
import {
  TWO_FACTOR_REQUIRED,
  TWO_FACTOR_INVALID,
  TWO_FACTOR_RATE_LIMITED,
} from '#app/lib/twoFactorCodes';

class TwoFactorSignin extends CredentialsSignin {
  constructor(public code: string) {
    super();
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
        code: { label: 'Two-factor code', type: 'text' },
      },
      authorize: async (credentials) => {
        const username = credentials?.username?.toString().trim();
        const password = credentials?.password?.toString();

        if (!username || !password) return null;

        const user = await getDataStrict(redisKeys.user(username));
        const passwordHash = getPasswordHash(user);
        if (!passwordHash) return null;

        const isValid = await bcrypt.compare(password, passwordHash);
        if (!isValid) return null;

        const twoFactor = await readTwoFactor(username);
        if (twoFactor !== null) {
          const code = credentials.code;
          if (typeof code !== 'string' || !code.trim()) {
            throw new TwoFactorSignin(TWO_FACTOR_REQUIRED);
          }
          if (code.length > 64) throw new TwoFactorSignin(TWO_FACTOR_INVALID);

          const result = await verifyTwoFactor(username, twoFactor, code);
          if (result !== 'verified') {
            throw new TwoFactorSignin(
              result === 'rate-limited'
                ? TWO_FACTOR_RATE_LIMITED
                : TWO_FACTOR_INVALID,
            );
          }
        }

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
