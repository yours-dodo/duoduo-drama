import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  const contentType = response.headers.get('content-type') ?? '';

  if (
    contentType.includes('text/html') ||
    contentType.includes('application/json') ||
    contentType.includes('text/css') ||
    contentType.includes('javascript')
  ) {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
  }

  return response;
});
