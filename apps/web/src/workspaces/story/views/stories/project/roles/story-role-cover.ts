export const MAX_COVER_ASSET_BYTES = 20 * 1024 * 1024;

const SUPPORTED_COVER_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function isSupportedCoverContentType(contentType: string): boolean {
  return SUPPORTED_COVER_CONTENT_TYPES.has(contentType);
}
