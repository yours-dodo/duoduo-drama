import { ApiError, classifyApiError } from './api-error';

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  try {
    const response = await fetch(`/api/${path.replace(/^\//, '')}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    });

    if (!response.ok) {
      let message = `Server request failed with status ${response.status}`;
      try {
        const body = (await response.json()) as { message?: string };
        message = body.message ?? message;
      } catch {
        // Keep the stable status-based error when the response is not JSON.
      }
      throw new ApiError(
        response.status,
        classifyApiError(response.status),
        message,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接到创作服务，请稍后重试。');
  }
}
