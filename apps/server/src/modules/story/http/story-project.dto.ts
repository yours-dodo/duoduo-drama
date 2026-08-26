import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateStoryProjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsIn(['standard', 'immersive'])
  creationMode: 'standard' | 'immersive' = 'standard';

  @IsOptional()
  @IsIn(['team', 'private'])
  visibility: 'team' | 'private' = 'team';
}

export class UpdateStoryProjectDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['现代', '古代'])
  era?: '现代' | '古代';

  @IsOptional()
  @IsArray()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
      : value,
  )
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(['team', 'private'])
  visibility?: 'team' | 'private';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class ArchiveStoryProjectDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class GenerateStoryProjectTagsDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class AddProjectCollaboratorDto {
  @IsUUID('4')
  userId!: string;

  @IsOptional()
  @IsIn(['viewer', 'editor', 'manager'])
  role: 'viewer' | 'editor' | 'manager' = 'editor';
}

export class UpdateProjectCollaboratorRoleDto {
  @IsIn(['viewer', 'editor', 'manager'])
  role!: 'viewer' | 'editor' | 'manager';
}

export class SetProjectCollaboratorPermissionOverrideDto {
  @IsIn(['project.archive'])
  permissionKey!: 'project.archive';

  @IsIn(['allow', 'deny'])
  effect!: 'allow' | 'deny';
}
