import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetPasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
