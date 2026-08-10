import type { APIRoute } from 'astro';

export const prerender = false;

const serverApiUrl = process.env.SERVER_API_URL ?? 'http://localhost:3001';

export const ALL: APIRoute = async ({ params, request }) => {
  const path = params.path ?? '';
  const target = new URL(`/${path}`, serverApiUrl);
  const headers = new Headers(request.headers);
  headers.delete('host');

  const body = ['GET', 'HEAD'].includes(request.method)
    ? undefined
    : await request.arrayBuffer();
  const response = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
  });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-length');
  responseHeaders.delete('content-encoding');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
