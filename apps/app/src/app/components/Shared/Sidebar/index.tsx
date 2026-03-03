'use client';

import { Box, Flex, IconButton, VStack } from '@chakra-ui/react';
import { useRouter, usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { FiActivity, FiBarChart2, FiLogOut, FiPlay } from 'react-icons/fi';

export const Sidebar = () => {
  const router = useRouter();
  const pathname = usePathname();

  const navItems = [
    {
      icon: FiBarChart2,
      label: 'Dashboard',
      path: '/routes/dashboard',
    },
    {
      icon: FiPlay,
      label: 'Backtest',
      path: '/routes/backtest',
    },
    {
      icon: FiActivity,
      label: 'Derivatives',
      path: '/routes/derivatives',
    },
  ];

  return (
    <Box
      position="fixed"
      top={0}
      left={0}
      h="100vh"
      w="60px"
      bg="gray.800"
      color="white"
      py={4}
      px={3}
      zIndex={1000}
    >
      <Flex direction="column" h="100%" justify="space-between">
        <VStack>
          {navItems.map(({ icon: Icon, label, path }) => (
            <IconButton
              key={path}
              mb={2}
              aria-label={label}
              size="md"
              colorPalette="teal"
              variant={pathname.includes(path) ? 'solid' : 'outline'}
              onClick={() => router.push(path)}
            >
              <Icon />
            </IconButton>
          ))}
        </VStack>

        <IconButton
          aria-label="Sign out"
          size="md"
          colorPalette="teal"
          variant="outline"
          onClick={() => signOut({ callbackUrl: '/routes/signin' })}
        >
          <FiLogOut />
        </IconButton>
      </Flex>
    </Box>
  );
};
