import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import Install from '../page';

const router = { replace: jest.fn() };
const fetchMock = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => router }));
jest.mock('next-auth/react', () => ({ signIn: jest.fn() }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));

describe('installation navigation', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    router.replace.mockClear();
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps the first dashboard when authentication remounts the completed installer', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ required: true }),
    });
    const view = render(
      <ChakraProvider value={defaultSystem}>
        <Install />
      </ChakraProvider>,
    );
    await waitFor(() => {
      expect(
        screen
          .getByLabelText('Password', { exact: true })
          .hasAttribute('disabled'),
      ).toBe(false);
    });
    expect(router.replace).not.toHaveBeenCalled();
    view.unmount();

    // The session cache boundary remounts its children when sign-in changes
    // identity. The password is already saved by this second installation check.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ required: false }),
    });
    render(
      <ChakraProvider value={defaultSystem}>
        <Install />
      </ChakraProvider>,
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        '/routes/dashboard/coinbase/crypto/BTCUSDT/15',
      ),
    );
    expect(router.replace).not.toHaveBeenCalledWith('/routes/signin');
  });
});
