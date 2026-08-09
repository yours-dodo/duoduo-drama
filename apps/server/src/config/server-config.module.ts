import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { parseServerConfig, SERVER_CONFIG } from './server-config.js';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    {
      provide: SERVER_CONFIG,
      useFactory: () => parseServerConfig(process.env),
    },
  ],
  exports: [SERVER_CONFIG],
})
export class ServerConfigModule {}
