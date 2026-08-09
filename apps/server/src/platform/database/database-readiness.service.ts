import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

export interface DatabaseReadinessProbe {
  ping(): Promise<void>;
}

@Injectable()
export class DatabaseReadinessService {
  constructor(
    @Inject(PrismaService) private readonly probe: DatabaseReadinessProbe,
  ) {}

  async isReady(): Promise<boolean> {
    try {
      await this.probe.ping();
      return true;
    } catch {
      return false;
    }
  }
}
