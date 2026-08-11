import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import {
  OBJECT_STORAGE_CONFIG,
  parseObjectStorageConfig,
  parseServerConfig,
  SERVER_CONFIG,
} from './server-config.js';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    {
      provide: SERVER_CONFIG,
      useFactory: () => parseServerConfig(process.env),
    },
    {
      provide: OBJECT_STORAGE_CONFIG,
      useFactory: () => parseObjectStorageConfig(process.env),
    },
  ],
  exports: [SERVER_CONFIG, OBJECT_STORAGE_CONFIG],
})
export class ServerConfigModule {}
