import {
  Controller,
  Get,
  Inject,
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
import { SessionAuthGuard } from '../../identity/http/session-auth.guard.js';
import { KeysetPageDto } from '../../tenancy/http/keyset-page.dto.js';
import {
  readTenantContext,
  TenantContextGuard,
} from '../../tenancy/http/tenant-context.guard.js';
import { throwTenancyHttpError } from '../../tenancy/http/tenancy-http-errors.js';
import { ListAuditRecords } from '../application/list-audit-records.js';

@Controller({ path: 'teams/:teamId/audit-records', version: '1' })
@UseGuards(SessionAuthGuard, TenantContextGuard)
export class AuditRecordsController {
  constructor(
    @Inject(ListAuditRecords)
    private readonly listAuditRecords: ListAuditRecords,
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
        await this.listAuditRecords.execute({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          page: readKeysetPage(query),
        }),
      );
    } catch (error) {
      throwTenancyHttpError(error);
    }
  }
}
