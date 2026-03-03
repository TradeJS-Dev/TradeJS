import { EmptyState as EmptyStateUI, VStack } from '@chakra-ui/react';
import { IconType } from 'react-icons';

interface EmptyStateProps {
  title: string;
  description: React.ReactNode;
  icon: IconType;
}

export const EmptyState = ({
  icon: Icon,
  title,
  description,
}: EmptyStateProps) => {
  return (
    <EmptyStateUI.Root>
      <EmptyStateUI.Content>
        <EmptyStateUI.Indicator>
          <Icon />
        </EmptyStateUI.Indicator>
        <VStack textAlign="center">
          <EmptyStateUI.Title>{title}</EmptyStateUI.Title>
          <EmptyStateUI.Description>{description}</EmptyStateUI.Description>
        </VStack>
      </EmptyStateUI.Content>
    </EmptyStateUI.Root>
  );
};
