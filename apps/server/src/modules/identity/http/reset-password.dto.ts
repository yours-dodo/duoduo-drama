import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(254)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6 digit code' })
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
