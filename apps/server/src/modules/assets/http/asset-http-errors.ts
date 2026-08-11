import { HttpStatus } from '@nestjs/common';

import { ObjectStorageUnavailableError } from '../../../platform/object-storage/object-storage.js';
import { ApplicationError } from '../../../platform/http/application-error.js';
import {
  AssetNotFoundError,
  AssetStateConflictError,
  AssetUploadExpiredError,
  AssetUploadInvalidError,
  AssetUploadMismatchError,
  AssetUploadMissingObjectError,
} from '../application/asset-errors.js';
import { throwStoryHttpError } from '../../story/http/story-http-errors.js';

export function throwAssetHttpError(error: unknown): never {
  if (error instanceof AssetNotFoundError) {
    throw assetError(
      'ASSET_NOT_FOUND',
      'Asset not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof AssetUploadInvalidError) {
    throw assetError(
      'ASSET_UPLOAD_INVALID',
      error.message,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof AssetUploadExpiredError) {
    throw assetError(
      'ASSET_UPLOAD_EXPIRED',
      'Asset upload URL has expired',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof AssetUploadMissingObjectError) {
    throw assetError(
      'ASSET_UPLOAD_MISSING_OBJECT',
      'Uploaded asset was not found in object storage',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof AssetUploadMismatchError) {
    throw assetError(
      'ASSET_UPLOAD_MISMATCH',
      'Uploaded asset does not match the requested metadata',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof AssetStateConflictError) {
    throw assetError(
      'ASSET_STATE_CONFLICT',
      'Asset is not in a state that supports this operation',
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof ObjectStorageUnavailableError) {
    throw assetError(
      'OBJECT_STORAGE_UNAVAILABLE',
      'Object storage is temporarily unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return throwStoryHttpError(error);
}

function assetError(
  code: string,
  message: string,
  statusCode: number,
): ApplicationError {
  return new ApplicationError({ code, message, statusCode });
}
