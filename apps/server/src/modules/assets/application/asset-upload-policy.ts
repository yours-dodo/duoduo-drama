import { AssetUploadInvalidError } from './asset-errors.js';

export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const SUPPORTED_ASSET_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export function validateAssetUpload(input: {
  fileName: string;
  contentType: string;
  byteSize: number;
}): { fileName: string; contentType: string; byteSize: number } {
  const fileName = input.fileName.trim();
  if (
    fileName.length === 0 ||
    fileName.length > 255 ||
    [...fileName].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  ) {
    throw new AssetUploadInvalidError('The asset file name is invalid');
  }
  if (
    !SUPPORTED_ASSET_CONTENT_TYPES.includes(
      input.contentType as (typeof SUPPORTED_ASSET_CONTENT_TYPES)[number],
    )
  ) {
    throw new AssetUploadInvalidError(
      'The asset content type is not supported',
    );
  }
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > MAX_ASSET_BYTES
  ) {
    throw new AssetUploadInvalidError(
      `The asset must be between 1 byte and ${MAX_ASSET_BYTES} bytes`,
    );
  }
  return { fileName, contentType: input.contentType, byteSize: input.byteSize };
}

export function assetObjectKey(input: {
  tenantId: string | null;
  projectId: string;
  assetId: string;
}): string {
  return input.tenantId
    ? `tenants/${input.tenantId}/story-projects/${input.projectId}/assets/${input.assetId}/original`
    : `personal/story-projects/${input.projectId}/assets/${input.assetId}/original`;
}
