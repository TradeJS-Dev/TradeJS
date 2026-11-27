'use client';

import { safeCallbackUrl } from '#app/lib/safeCallbackUrl';
import {
  TWO_FACTOR_REQUIRED,
  TWO_FACTOR_INVALID,
  TWO_FACTOR_RATE_LIMITED,
} from '#app/lib/twoFactorCodes';
import { AuthenticatorCodeField } from '#shared/AuthenticatorCodeField';
import { PageHeader } from '#shared/PageLayout';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { signIn, useSession } from 'next-auth/react';
import { Box, Button, Field, Flex, Input, Stack, Text } from '@chakra-ui/react';

const SigninContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [digits, setDigits] = useState<string[]>([]);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const code = recoveryCode ?? digits.join('');
  const codeComplete =
    recoveryCode === null ? code.length === 6 : Boolean(recoveryCode.trim());
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const callbackUrl = useMemo(
    () =>
      safeCallbackUrl(
        searchParams.get('callbackUrl'),
        typeof window === 'undefined'
          ? 'http://localhost'
          : window.location.origin,
      ),
    [searchParams],
  );

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(callbackUrl);
    }
  }, [status, router, callbackUrl]);

  useEffect(() => {
    const suggestedUsername = searchParams.get('username')?.trim();
    if (suggestedUsername) {
      setUsername((current) => current || suggestedUsername);
    }
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError('');
    if (!username.trim() || !password) {
      setError('Please enter username and password');
      return;
    }
    if (needsCode && !codeComplete) return;
    setIsSubmitting(true);

    try {
      const result = await signIn('credentials', {
        redirect: false,
        username,
        password,
        code: needsCode ? code : '',
        callbackUrl,
      });

      if (result?.code === TWO_FACTOR_REQUIRED) {
        setNeedsCode(true);
        return;
      }
      if (result?.code === TWO_FACTOR_INVALID) {
        setError('Invalid or already used code');
        return;
      }
      if (result?.code === TWO_FACTOR_RATE_LIMITED) {
        setError('Too many attempts. Try again in five minutes.');
        return;
      }
      if (result?.error === 'CredentialsSignin') {
        setError('Invalid username or password');
        return;
      }
      if (!result?.ok || result.error) {
        setError('Sign-in is temporarily unavailable. Try again.');
        return;
      }

      router.replace(callbackUrl);
    } catch {
      setError('Sign-in is temporarily unavailable. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Flex minH="100vh" direction={{ base: 'column', lg: 'row' }} bg="bg.subtle">
      <Flex
        w={{ base: 'full', lg: '33.333%' }}
        px={{ base: 6, md: 10, lg: 12 }}
        py={{ base: 10, lg: 12 }}
        align="center"
        justify={{ base: 'center', lg: 'flex-start' }}
        minH={{ base: '100vh', lg: 'auto' }}
      >
        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <Box
            w="full"
            maxW={{ base: '360px', lg: '420px' }}
            mx={{ base: 'auto', lg: 0 }}
            display="flex"
            flexDirection="column"
            gap="6"
          >
            <Flex align="center" gap="3">
              <Image src="/tradejs-icon.svg" alt="" width={56} height={56} />
              <PageHeader title="Sign in to TradeJS" />
            </Flex>

            <Stack gap="4">
              <Field.Root>
                <Field.Label>Username</Field.Label>
                <Input
                  value={username}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setNeedsCode(false);
                    setDigits([]);
                    setRecoveryCode(null);
                  }}
                  autoComplete="username"
                  placeholder="Username"
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>Password</Field.Label>
                <Input
                  value={password}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setNeedsCode(false);
                    setDigits([]);
                    setRecoveryCode(null);
                  }}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                />
              </Field.Root>
              {needsCode && (
                <AuthenticatorCodeField
                  value={digits}
                  onChange={setDigits}
                  recovery={{ value: recoveryCode, onChange: setRecoveryCode }}
                  autoFocus
                  disabled={isSubmitting}
                />
              )}
            </Stack>

            {error ? (
              <Text fontSize="sm" color="red.300">
                {error}
              </Text>
            ) : null}

            <Button
              type="submit"
              loading={isSubmitting}
              disabled={!username || !password || (needsCode && !codeComplete)}
              colorPalette="teal"
            >
              Sign in
            </Button>
          </Box>
        </form>
      </Flex>

      <Box
        display={{ base: 'none', lg: 'block' }}
        w={{ lg: '66.666%' }}
        minH="100vh"
        bg="bg.panel"
        position="relative"
        overflow="hidden"
      >
        <Image
          src="/auth-bg.jpg"
          alt="Market chart background"
          fill
          priority
          sizes="(min-width: 1024px) 66vw, 0vw"
          style={{ objectFit: 'cover', objectPosition: 'center' }}
        />
      </Box>
    </Flex>
  );
};

const SigninFallback = () => <Flex minH="100vh" bg="bg.subtle" />;

const Signin = () => (
  <Suspense fallback={<SigninFallback />}>
    <SigninContent />
  </Suspense>
);

export default Signin;
