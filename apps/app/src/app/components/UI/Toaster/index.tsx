'use client';

import { Portal, Toast, Toaster, createToaster } from '@chakra-ui/react';

export const toaster = createToaster({
  placement: 'bottom-end',
  offsets: '1rem',
  pauseOnPageIdle: true,
});

export const AppToaster = () => {
  return (
    <Portal>
      <Toaster toaster={toaster}>
        {(toast) => (
          <Toast.Root
            width={{ base: 'calc(100vw - 2rem)', md: 'sm' }}
            maxW="calc(100vw - 2rem)"
            bg="gray.700"
            color="gray.100"
            borderWidth="1px"
            borderColor="gray.600"
          >
            <Toast.Indicator
              color={
                toast.type === 'success'
                  ? 'green.400'
                  : toast.type === 'error'
                    ? 'red.400'
                    : toast.type === 'warning'
                      ? 'orange.300'
                      : 'gray.300'
              }
            />
            <Toast.Title>{toast.title}</Toast.Title>
            {toast.description ? (
              <Toast.Description>{toast.description}</Toast.Description>
            ) : null}
            <Toast.CloseTrigger />
          </Toast.Root>
        )}
      </Toaster>
    </Portal>
  );
};
