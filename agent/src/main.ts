import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';

import { AppModule } from './app.module.js';

const port = Number(process.env.PORT ?? 3002);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableVersioning({ type: VersioningType.URI });
  await app.listen(port);
}

void bootstrap();
