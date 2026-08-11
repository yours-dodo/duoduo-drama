import { Module } from '@nestjs/common';

import { ServerConfigModule } from '../../config/server-config.module.js';
import { OBJECT_STORAGE } from './object-storage.js';
import { S3ObjectStorage } from './s3/s3-object-storage.js';

@Module({
  imports: [ServerConfigModule],
  providers: [
    S3ObjectStorage,
    { provide: OBJECT_STORAGE, useExisting: S3ObjectStorage },
  ],
  exports: [OBJECT_STORAGE],
})
export class ObjectStorageModule {}
