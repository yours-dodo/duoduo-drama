export type QwenRegion =
  | 'cn-beijing'
  | 'ap-southeast-1'
  | 'us-east-1'
  | 'cn-hongkong'
  | 'ap-northeast-1'
  | 'eu-central-1';

export type QwenEndpointMode = 'shared' | 'workspace';

export interface ResolveQwenEndpointsOptions {
  readonly region: QwenRegion;
  readonly endpointMode?: QwenEndpointMode;
  readonly workspaceId?: string;
  readonly baseUrl?: URL | string;
}

export interface QwenEndpoints {
  readonly origin: string;
  readonly compatibleBaseUrl: string;
  readonly anthropicBaseUrl: string;
  readonly nativeBaseUrl: string;
}

const sharedHosts: Readonly<Partial<Record<QwenRegion, string>>> =
  Object.freeze({
    'cn-beijing': 'dashscope.aliyuncs.com',
    'ap-southeast-1': 'dashscope-intl.aliyuncs.com',
    'us-east-1': 'dashscope-us.aliyuncs.com',
    'cn-hongkong': 'cn-hongkong.dashscope.aliyuncs.com',
  });

const workspaceRegions = new Set<QwenRegion>([
  'cn-beijing',
  'ap-southeast-1',
  'cn-hongkong',
  'ap-northeast-1',
  'eu-central-1',
]);

export function resolveQwenEndpoints(
  options: ResolveQwenEndpointsOptions,
): QwenEndpoints {
  const mode = options.endpointMode ?? 'shared';
  let generatedOrigin: string;
  if (mode === 'shared') {
    if (options.workspaceId !== undefined)
      throw new Error('Qwen shared mode forbids workspaceId');
    const host = sharedHosts[options.region];
    if (!host)
      throw new Error(
        `Qwen shared mode is not supported in region ${options.region}`,
      );
    generatedOrigin = `https://${host}`;
  } else {
    const workspaceId = requireWorkspaceId(options.workspaceId);
    if (!workspaceRegions.has(options.region))
      throw new Error(
        `Qwen workspace mode is not supported in region ${options.region}`,
      );
    generatedOrigin = `https://${workspaceId}.${options.region}.maas.aliyuncs.com`;
  }

  const root = options.baseUrl
    ? normalizeExplicitBaseUrl(options.baseUrl)
    : generatedOrigin;
  return Object.freeze({
    origin: new URL(root).origin,
    compatibleBaseUrl: appendPath(root, 'compatible-mode/v1'),
    anthropicBaseUrl: appendPath(root, 'apps/anthropic'),
    nativeBaseUrl: appendPath(root, 'api/v1'),
  });
}

function requireWorkspaceId(value: string | undefined): string {
  if (!value) throw new Error('Qwen workspaceId is required in workspace mode');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value))
    throw new Error('Qwen workspaceId is invalid');
  return value;
}

function normalizeExplicitBaseUrl(value: URL | string): string {
  const url = new URL(value.toString());
  if (url.protocol !== 'https:') throw new Error('Qwen baseUrl must use https');
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'Qwen baseUrl cannot contain credentials, query, or fragment',
    );
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.href.replace(/\/$/u, '');
}

export function appendPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (path.startsWith('/') || path.includes('?') || path.includes('#'))
    throw new Error('Qwen route must be a trusted relative path');
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/${path}`;
  return url.href;
}
