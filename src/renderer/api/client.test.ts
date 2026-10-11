import { API_UNAVAILABLE_MESSAGE, ApiError, isApiAvailable, toApiError, unwrap } from './client';

const removeApi = () => {
  Object.defineProperty(window, 'api', { value: undefined, configurable: true, writable: true });
};

describe('unwrap', () => {
  it('resolves to the data of a successful response', async () => {
    const launch = { enabled: true, startMinimised: false };
    jest.mocked(window.api.app.getAutoLaunch).mockResolvedValue({ success: true, data: launch });
    await expect(unwrap((api) => api.app.getAutoLaunch())).resolves.toEqual(launch);
    await expect(unwrap(Promise.resolve({ success: true, data: [1, 2] }))).resolves.toEqual([1, 2]);
  });

  it('rejects with an ApiError carrying the response message, code and issues', async () => {
    const failure = unwrap(
      Promise.resolve({
        success: false,
        error: 'Arrival must be before departure',
        code: 'VALIDATION',
        issues: ['arrival'],
      })
    );
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      message: 'Arrival must be before departure',
      code: 'VALIDATION',
      issues: ['arrival'],
    });
  });

  it('gives a failed response with no message a plain-language one', async () => {
    await expect(unwrap(Promise.resolve({ success: false }))).rejects.toMatchObject({
      message: 'WA Stay could not complete that request.',
    });
  });

  it('turns a rejected IPC call into an ApiError with its message', async () => {
    const failure = unwrap(Promise.reject(new Error('IPC channel closed')));
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ message: 'IPC channel closed' });
  });

  it('throws ApiError API_UNAVAILABLE when there is no window.api', async () => {
    removeApi();
    expect(isApiAvailable()).toBe(false);
    const call = jest.fn();
    await expect(unwrap(call)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'API_UNAVAILABLE',
      message: API_UNAVAILABLE_MESSAGE,
    });
    expect(call).not.toHaveBeenCalled();
  });
});

describe('toApiError', () => {
  it('keeps an ApiError and wraps anything else', () => {
    const original = new ApiError('Not found', 'NOT_FOUND');
    expect(toApiError(original)).toBe(original);
    expect(toApiError(new TypeError('boom'))).toMatchObject({ name: 'ApiError', message: 'boom' });
    expect(toApiError('plain')).toMatchObject({ message: 'plain', code: undefined });
  });
});
