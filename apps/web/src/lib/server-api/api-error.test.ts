import { describe, expect, it } from 'vitest';

import { ApiError, classifyApiError } from './api-error';

describe('classifyApiError', () => {
  it('maps authentication and authorization failures', () => {
    expect(classifyApiError(401)).toBe('UNAUTHENTICATED');
    expect(classifyApiError(403)).toBe('FORBIDDEN');
  });

  it('maps resource and validation failures', () => {
    expect(classifyApiError(404)).toBe('NOT_FOUND');
    expect(classifyApiError(409)).toBe('CONFLICT');
    expect(classifyApiError(400)).toBe('VALIDATION_FAILED');
    expect(classifyApiError(422)).toBe('VALIDATION_FAILED');
  });

  it('keeps server failures separate from client validation', () => {
    expect(classifyApiError(503)).toBe('SERVER_ERROR');
    expect(classifyApiError(0)).toBe('NETWORK_ERROR');
  });
});

describe('ApiError', () => {
  it('keeps status and stable code available to UI adapters', () => {
    const error = new ApiError(401, 'UNAUTHENTICATED', '登录已过期');

    expect(error).toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'UNAUTHENTICATED',
      message: '登录已过期',
    });
  });
});
