'use client';

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
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const callbackUrl = useMemo(
    () => searchParams.get('callbackUrl') ?? '/routes/dashboard',
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
    setError('');
    if (!username.trim() || !password) {
      setError('Please enter username and password');
      return;
    }
    setIsSubmitting(true);

    const result = await signIn('credentials', {
      redirect: false,
      username,
      password,
      callbackUrl,
    });

    setIsSubmitting(false);

    if (!result || result.error) {
      setError('Invalid username or password');
      return;
    }

    router.replace(callbackUrl);
  };

  return (
    <Flex minH="100vh" direction={{ base: 'column', lg: 'row' }} bg="gray.950">
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
            <Stack gap="4">
              <Text fontSize="sm" opacity={0.7} letterSpacing="0.2em">
                SIGN IN
              </Text>
              <Text
                fontSize="2xl"
                fontWeight="700"
                letterSpacing="-0.03em"
                lineHeight="1"
                color="white"
              >
                <Box as="span">Trade</Box>
                <Box as="span" color="#20c5bd">
                  JS
                </Box>
              </Text>
            </Stack>

            <Stack gap="4">
              <Field.Root>
                <Field.Label>Username</Field.Label>
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="Username"
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>Password</Field.Label>
                <Input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                />
              </Field.Root>
            </Stack>

            {error ? (
              <Text fontSize="sm" color="red.300">
                {error}
              </Text>
            ) : null}

            <Button
              type="submit"
              loading={isSubmitting}
              disabled={!username || !password}
              bg="gray.900"
              color="white"
              _hover={{ bg: 'gray.800' }}
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

const SigninFallback = () => <Flex minH="100vh" bg="gray.950" />;

const Signin = () => (
  <Suspense fallback={<SigninFallback />}>
    <SigninContent />
  </Suspense>
);

export default Signin;
