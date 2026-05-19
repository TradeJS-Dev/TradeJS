'use client';

import { Box } from '@chakra-ui/react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '#shared/Sidebar';

const AUTH_ROUTES = ['/routes/signin'];

const isAuthRoute = (pathname: string) =>
  AUTH_ROUTES.some((route) => pathname.startsWith(route));

export const AppShell = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const hideSidebar = isAuthRoute(pathname);

  if (hideSidebar) {
    return <Box minH="100vh">{children}</Box>;
  }

  return (
    <>
      <Sidebar />
      <Box ml="60px" minH="100vh">
        {children}
      </Box>
    </>
  );
};
