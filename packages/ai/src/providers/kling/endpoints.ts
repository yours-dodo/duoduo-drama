export interface ResolveKlingEndpointsOptions {
  readonly baseUrl?: URL | string;
}

export interface KlingEndpoints {
  readonly origin: string;
  readonly baseUrl: string;
  readonly omniVideoCreateUrl: string;
  taskQueryUrl(taskId: string): string;
}

export function resolveKlingEndpoints(
  options: ResolveKlingEndpointsOptions = {},
): KlingEndpoints {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? 'https://api-singapore.klingai.com',
  );
  return Object.freeze({
    origin: new URL(baseUrl).origin,
    baseUrl,
    omniVideoCreateUrl: appendTrustedPath(baseUrl, 'omni-video/kling-3.0-omni'),
    taskQueryUrl(taskId: string): string {
      const url = new URL('/tasks', baseUrl);
      url.searchParams.set('task_ids', taskId);
      return url.href;
    },
  });
}

function appendTrustedPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/${path}`;
  return url.href;
}

function normalizeBaseUrl(value: URL | string): string {
  const url = new URL(value.toString());
  if (url.protocol !== 'https:')
    throw new Error('Kling baseUrl must use https');
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'Kling baseUrl cannot contain credentials, query, or fragment',
    );
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.href.replace(/\/$/u, '');
}
