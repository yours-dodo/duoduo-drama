import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class PasswordLoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(254)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
