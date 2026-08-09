import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { SERVER_CONFIG, type ServerConfig } from './config/server-config.js';
import { configureHttpApp } from './platform/http/configure-http-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ServerConfig>(SERVER_CONFIG);

  configureHttpApp(app, config);

  await app.listen(config.port);
}

void bootstrap();
