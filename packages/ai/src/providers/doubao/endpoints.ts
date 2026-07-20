export type DoubaoRegion = 'cn-beijing';

export interface ResolveDoubaoEndpointsOptions {
  readonly region?: DoubaoRegion;
  readonly baseUrl?: URL | string;
}

export interface DoubaoEndpoints {
  readonly origin: string;
  readonly baseUrl: string;
  readonly responsesUrl: string;
  readonly chatCompletionsUrl: string;
  readonly imagesUrl: string;
  readonly contentsGenerationTasksUrl: string;
}

export function resolveDoubaoEndpoints(
  options: ResolveDoubaoEndpointsOptions = {},
): DoubaoEndpoints {
  const region = options.region ?? 'cn-beijing';
  if (region !== 'cn-beijing')
    throw new Error(`unsupported Doubao region: ${String(region)}`);
  const baseUrl = options.baseUrl
    ? normalizeBaseUrl(options.baseUrl)
    : 'https://ark.cn-beijing.volces.com/api/v3';
  return Object.freeze({
    origin: new URL(baseUrl).origin,
    baseUrl,
    responsesUrl: appendDoubaoPath(baseUrl, 'responses'),
    chatCompletionsUrl: appendDoubaoPath(baseUrl, 'chat/completions'),
    imagesUrl: appendDoubaoPath(baseUrl, 'images/generations'),
    contentsGenerationTasksUrl: appendDoubaoPath(
      baseUrl,
      'contents/generations/tasks',
    ),
  });
}

export function appendDoubaoPath(baseUrl: string, path: string): string {
  if (path.startsWith('/') || path.includes('?') || path.includes('#'))
    throw new Error('Doubao route must be a trusted relative path');
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/${path}`;
  return url.href;
}

function normalizeBaseUrl(value: URL | string): string {
  const url = new URL(value.toString());
  if (url.protocol !== 'https:')
    throw new Error('Doubao baseUrl must use https');
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'Doubao baseUrl cannot contain credentials, query, or fragment',
    );
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.href.replace(/\/$/u, '');
}
