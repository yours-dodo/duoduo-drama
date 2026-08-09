import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class CreateTeamInvitationDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class AcceptTeamInvitationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class ChangeTeamMemberRoleDto {
  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}
