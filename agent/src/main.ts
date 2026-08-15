import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { json, urlencoded } from 'express';

import { AppModule } from './app.module.js';

const port = Number(process.env.PORT ?? 3002);

try {
  (process as { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  // agent/.env is optional; configuration may come from the process env.
}

function corsOrigins(value: string | undefined): string[] | boolean {
  const origins = value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins && origins.length > 0
    ? origins
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ extended: true, limit: '100mb' }));
  app.enableCors({ origin: corsOrigins(process.env.AGENT_CORS_ORIGINS) });
  app.enableVersioning({ type: VersioningType.URI });
  await app.listen(port);
}

void bootstrap();
