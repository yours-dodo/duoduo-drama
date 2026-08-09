import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  keysetPageResponse,
  readKeysetPage,
} from '../../../platform/http/keyset-page.js';
import { readRequestId } from '../../../platform/http/request-id.middleware.js';
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import { ChangeTeamMemberRole } from '../application/change-team-member-role.js';
import { ListTeamMembers } from '../application/list-team-members.js';
import { RemoveTeamMember } from '../application/remove-team-member.js';
import { KeysetPageDto } from './keyset-page.dto.js';
import { ChangeTeamMemberRoleDto } from './team-lifecycle.dto.js';
import {
  readTenantContext,
  TenantContextGuard,
} from './tenant-context.guard.js';
import { throwTenancyHttpError } from './tenancy-http-errors.js';

@Controller({ path: 'teams/:teamId/members', version: '1' })
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class TeamMembersController {
  constructor(
    @Inject(ListTeamMembers) private readonly listMembers: ListTeamMembers,
    @Inject(ChangeTeamMemberRole)
    private readonly changeRole: ChangeTeamMemberRole,
    @Inject(RemoveTeamMember) private readonly removeMember: RemoveTeamMember,
  ) {}

  @Get()
  async list(
    @Query(
      new ValidationPipe({
        expectedType: KeysetPageDto,
        transform: true,
        whitelist: true,
      }),
    )
    query: KeysetPageDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return keysetPageResponse(
        await this.listMembers.execute({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          page: readKeysetPage(query),
        }),
      );
    } catch (error) {
      throwTenancyHttpError(error);
    }
  }

  @Patch(':membershipId')
  async changeMemberRole(
    @Param('membershipId', new ParseUUIDPipe({ version: '4' }))
    membershipId: string,
    @Body() body: ChangeTeamMemberRoleDto,
    @Req() request: Request,
  ) {
    const tenant = readTenantContext(request);
    try {
      return await this.changeRole.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        membershipId,
        role: body.role,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwTenancyHttpError(error);
    }
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('membershipId', new ParseUUIDPipe({ version: '4' }))
    membershipId: string,
    @Req() request: Request,
  ): Promise<void> {
    const tenant = readTenantContext(request);
    try {
      await this.removeMember.execute({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        membershipId,
        requestId: readRequestId(request),
      });
    } catch (error) {
      throwTenancyHttpError(error);
    }
  }
}
