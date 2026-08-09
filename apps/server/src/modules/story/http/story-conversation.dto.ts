import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateStoryConversationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}

export class UpdateStoryConversationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class ArchiveStoryConversationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class AppendStoryMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  body!: string;
}
