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
  MAX_STORY_IMPORT_BYTES,
  STORY_IMPORT_CONTENT_TYPES,
  type StoryImportContentType,
} from '../../../domain/story/story-import-job.js';

export class CreateStoryImportJobDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim() || 'application/octet-stream'
      : value,
  )
  @IsIn(STORY_IMPORT_CONTENT_TYPES)
  contentType!: StoryImportContentType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_STORY_IMPORT_BYTES)
  byteSize!: number;
}
