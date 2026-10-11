import { ApiError } from '../api';
import { createQueryClient, shouldRetryQuery } from './queryClient';

describe('shouldRetryQuery', () => {
  it.each([
    'VALIDATION',
    'CAPABILITY',
    'NOT_FOUND',
    'NOT_IMPLEMENTED',
    'API_UNAVAILABLE',
    'RATE_LIMITED',
  ])('never retries %s: a retry cannot fix it, or is what it asks us not to do', (code) => {
    expect(shouldRetryQuery(0, new ApiError('no', code))).toBe(false);
  });

  it('retries any other failure once', () => {
    for (const error of [new ApiError('down', 'INTERNAL'), new ApiError('?'), new Error('x')]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(1, error)).toBe(false);
    }
  });
});

describe('createQueryClient', () => {
  it('uses the app defaults', () => {
    const { queries, mutations } = createQueryClient().getDefaultOptions();
    expect(queries?.staleTime).toBe(60_000);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.retry).toBe(shouldRetryQuery);
    expect(mutations?.retry).toBe(0);
  });

  it('makes a separate client each time', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
