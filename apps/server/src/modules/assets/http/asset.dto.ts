import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  MAX_ASSET_BYTES,
  SUPPORTED_ASSET_CONTENT_TYPES,
} from '../application/asset-upload-policy.js';

export class CreateAssetUploadUrlDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsIn(SUPPORTED_ASSET_CONTENT_TYPES)
  contentType!: (typeof SUPPORTED_ASSET_CONTENT_TYPES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ASSET_BYTES)
  byteSize!: number;
}
