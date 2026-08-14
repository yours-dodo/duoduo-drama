import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../platform/database/database.module.js';
import { PrismaSpaceRepository } from './infrastructure/prisma-space.repository.js';
import { SPACE_REPOSITORY } from './ports/space-repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    PrismaSpaceRepository,
    { provide: SPACE_REPOSITORY, useExisting: PrismaSpaceRepository },
  ],
  exports: [SPACE_REPOSITORY],
})
export class SpacesModule {}
