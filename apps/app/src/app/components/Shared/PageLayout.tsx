import type { ReactNode } from 'react';
import {
  Box,
  Button,
  Flex,
  Heading,
  Text,
  type BoxProps,
  type ButtonProps,
} from '@chakra-ui/react';

export function PageLayout({ maxW = '1500px', ...props }: BoxProps) {
  return (
    <Box
      as="main"
      w="full"
      minW={0}
      maxW={maxW}
      px={{ base: 3, md: 4 }}
      pt={4}
      pb={8}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Flex
      as="header"
      align="center"
      justify="space-between"
      gap={3}
      wrap="wrap"
      minH={9}
    >
      <Box minW={0}>
        <Heading as="h1" size="xl" fontWeight="semibold">
          {title}
        </Heading>
        {description && (
          <Text mt={1} color="fg.muted" textStyle="sm">
            {description}
          </Text>
        )}
      </Box>
      {actions && (
        <Flex align="center" gap={2} wrap="wrap">
          {actions}
        </Flex>
      )}
    </Flex>
  );
}

export function PageAction(props: ButtonProps) {
  return <Button size="sm" variant="outline" {...props} />;
}
