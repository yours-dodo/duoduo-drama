import axios, { AxiosError } from 'axios';

export interface AdminApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class AdminApiError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    payload: AdminApiErrorPayload,
    options: { status?: number } = {},
  ) {
    super(payload.message);
    this.name = 'AdminApiError';
    this.code = payload.code;
    this.details = payload.details;
    this.status = options.status;
  }
}

export const adminHttpClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 10_000,
  withCredentials: true,
});

adminHttpClient.interceptors.request.use((config) => {
  config.headers.set('x-request-id', crypto.randomUUID());
  return config;
});

adminHttpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<AdminApiErrorPayload>) => {
    if (error.response?.data) {
      throw new AdminApiError(error.response.data, {
        status: error.response.status,
      });
    }

    throw new AdminApiError({
      code: error.code === 'ECONNABORTED' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      message: error.message || 'Admin API request failed',
    });
  },
);
