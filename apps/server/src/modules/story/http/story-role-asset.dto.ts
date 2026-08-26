import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmpty,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  STORY_ROLE_APPEARANCE_FREQUENCIES,
  STORY_ROLE_CAMPS,
  STORY_ROLE_CATEGORIES,
  STORY_ROLE_GENDERS,
  type StoryRoleAppearanceFrequency,
  type StoryRoleCamp,
  type StoryRoleCategory,
  type StoryRoleGender,
} from '../../../domain/story/story-role-asset.js';

function trimmed(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function trimmedArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;
}

export class StoryRoleDialogueExampleDto {
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MaxLength(300)
  context!: string;

  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  line!: string;
}

export class StoryRoleSpeechProfileDto {
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MaxLength(2000)
  style!: string;

  @Transform(({ value }) => trimmedArray(value))
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(500, { each: true })
  habits!: string[];

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => StoryRoleDialogueExampleDto)
  dialogueExamples!: StoryRoleDialogueExampleDto[];
}

export class CreateStoryRoleAssetDto {
  @IsEmpty({ message: 'id must not be supplied' })
  id?: never;

  @IsIn(STORY_ROLE_CATEGORIES)
  category!: StoryRoleCategory;

  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  occupation?: string;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personalityCore?: string;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  motivationConflict?: string;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  mainlineRelation?: string;

  @IsOptional()
  @IsIn(STORY_ROLE_GENDERS)
  gender?: StoryRoleGender;

  @IsOptional()
  @IsIn(STORY_ROLE_CAMPS)
  camp?: StoryRoleCamp;

  @IsOptional()
  @IsIn(STORY_ROLE_APPEARANCE_FREQUENCIES)
  appearanceFrequency?: StoryRoleAppearanceFrequency;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoryRoleSpeechProfileDto)
  speechProfile?: StoryRoleSpeechProfileDto;
}

export class UpdateStoryRoleAssetDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsOptional()
  @IsUUID('4')
  coverAssetId?: string | null;

  @IsOptional()
  @IsUUID('4')
  viewAssetId?: string | null;

  @IsOptional()
  @IsIn(STORY_ROLE_CATEGORIES)
  category?: StoryRoleCategory;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  occupation?: string;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personalityCore?: string;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  motivationConflict?: string;

  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  mainlineRelation?: string;

  @IsOptional()
  @IsIn(STORY_ROLE_GENDERS)
  gender?: StoryRoleGender;

  @IsOptional()
  @IsIn(STORY_ROLE_CAMPS)
  camp?: StoryRoleCamp;

  @IsOptional()
  @IsIn(STORY_ROLE_APPEARANCE_FREQUENCIES)
  appearanceFrequency?: StoryRoleAppearanceFrequency;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoryRoleSpeechProfileDto)
  speechProfile?: StoryRoleSpeechProfileDto;
}

export class ArchiveStoryRoleAssetQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
