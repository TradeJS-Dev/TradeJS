'use client';

import { PageHeader } from '#shared/PageLayout';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { Box, Button, Field, Flex, Input, Stack, Text } from '@chakra-ui/react';

const FIRST_DASHBOARD_PATH = '/routes/dashboard/coinbase/crypto/BTCUSDT/15';

const Install = () => {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void fetch('/api/install')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to check installation');
        return (await response.json()) as { required?: boolean };
      })
      .then(({ required }) => {
        if (!required) {
          router.replace('/routes/signin');
          return;
        }
        setIsLoading(false);
      })
      .catch(() => {
        setError('Unable to connect to the local TradeJS infrastructure');
        setIsLoading(false);
      });
  }, [router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must contain at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    const response = await fetch('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, confirmPassword }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error || 'Unable to install TradeJS');
      setIsSubmitting(false);
      return;
    }

    const result = await signIn('credentials', {
      redirect: false,
      username: 'root',
      password,
      callbackUrl: FIRST_DASHBOARD_PATH,
    });

    if (!result || result.error) {
      router.replace('/routes/signin');
      return;
    }

    router.replace(FIRST_DASHBOARD_PATH);
  };

  return (
    <Flex minH="100vh" direction={{ base: 'column', lg: 'row' }} bg="gray.950">
      <Flex
        w={{ base: 'full', lg: '33.333%' }}
        px={{ base: 6, md: 10, lg: 12 }}
        py={{ base: 10, lg: 12 }}
        align="center"
        justify="center"
        minH={{ base: '100vh', lg: 'auto' }}
      >
        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <Box w="full" maxW="420px" mx="auto">
            <Stack gap="6">
              <PageHeader
                title="Set up TradeJS"
                description="Create a password for the local root account."
              />

              <Stack gap="4">
                <Field.Root>
                  <Field.Label>Password</Field.Label>
                  <Input
                    aria-label="Password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    disabled={isLoading}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Confirm password</Field.Label>
                  <Input
                    aria-label="Confirm password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    disabled={isLoading}
                  />
                </Field.Root>
              </Stack>

              {error ? (
                <Text role="alert" fontSize="sm" color="red.300">
                  {error}
                </Text>
              ) : null}

              <Button
                type="submit"
                loading={isSubmitting || isLoading}
                disabled={isLoading || !password || !confirmPassword}
                colorPalette="teal"
              >
                Install and open dashboard
              </Button>
            </Stack>
          </Box>
        </form>
      </Flex>

      <Box
        display={{ base: 'none', lg: 'block' }}
        w={{ lg: '66.666%' }}
        minH="100vh"
        bg="gray.900"
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

export default Install;
