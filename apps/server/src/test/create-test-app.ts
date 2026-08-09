import type { INestApplication, InjectionToken, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { SERVER_CONFIG, type ServerConfig } from '../config/server-config.js';
import {
  configureHttpApp,
  type ConfigureHttpAppOptions,
} from '../platform/http/configure-http-app.js';
import { DatabaseReadinessService } from '../platform/database/database-readiness.service.js';

const TEST_SERVER_CONFIG: ServerConfig = {
  environment: 'test',
  port: 3001,
  cookieSecret: 'local-test-cookie-secret-change-me',
  trustedOrigins: ['http://localhost:3000'],
  databaseUrl:
    'postgresql://duoduo_server:test@127.0.0.1:55433/duoduo_server_test',
  publicWebUrl: 'http://localhost:3000',
  loginTokenPepper: 'local-test-login-token-pepper-change-me',
  trustedProxyHops: 1,
};

export interface CreateTestAppOptions extends ConfigureHttpAppOptions {
  controllers?: Type<unknown>[];
  databaseReady?: boolean;
  serverConfig?: ServerConfig;
  providerOverrides?: Array<{
    token: InjectionToken<unknown>;
    value: unknown;
  }>;
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<INestApplication> {
  const serverConfig = options.serverConfig ?? TEST_SERVER_CONFIG;
  let testingModuleBuilder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(SERVER_CONFIG)
    .useValue(serverConfig)
    .overrideProvider(DatabaseReadinessService)
    .useValue({
      isReady: async () => options.databaseReady ?? true,
    });

  for (const override of options.providerOverrides ?? []) {
    testingModuleBuilder = testingModuleBuilder
      .overrideProvider(override.token)
      .useValue(override.value);
  }

  const testingModule = await testingModuleBuilder.compile();
  const app = testingModule.createNestApplication();

  configureHttpApp(app, serverConfig, {
    requestLogSink: options.requestLogSink,
  });
  await app.init();

  return app;
}
