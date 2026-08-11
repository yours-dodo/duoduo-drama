import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyEmailCodeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(254)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6 digit code' })
  code!: string;
}
