import { getErrorMessage } from '../errorMessage';

describe('getErrorMessage', () => {
  it('formats object-shaped HTTP errors without leaking request metadata', () => {
    expect(
      getErrorMessage({
        code: 403,
        message: 'Forbidden',
        body: 'CloudFront blocked this request',
        requestOptions: { apiKey: 'secret' },
      }),
    ).toBe('403 Forbidden: CloudFront blocked this request');
  });

  it('keeps native error messages', () => {
    expect(getErrorMessage(new Error('scanner failed'))).toBe('scanner failed');
  });
});
