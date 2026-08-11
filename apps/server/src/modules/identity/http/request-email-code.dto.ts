import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class RequestEmailCodeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(254)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;
}
