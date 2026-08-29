import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class EditStoryDraftDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  content!: string;

  @IsEnum(['markdown', 'text'])
  contentFormat!: 'markdown' | 'text';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersionNumber!: number;
}

export class DiscardStoryDraftDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersionNumber!: number;
}

export class ConfirmStoryDraftDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersionNumber!: number;
}

export class RollbackStoryArtifactDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetVersionNumber!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  expectedCurrentVersionNumber?: number;
}

export class SaveStoryOutlineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(5_000_000)
  content!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersionNumber!: number;
}
