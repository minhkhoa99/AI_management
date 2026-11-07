import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { QA_DOCUMENT_MAX_BYTES } from '@aiteam/contracts';
import { AppModule } from './app.module';
import { NestLoggerAdapter } from './shared/logging/nest-logger.adapter';
import type { SharedInfrastructureDependencies } from './shared/shared-infrastructure.module';

export interface AiteamApplicationOptions extends SharedInfrastructureDependencies {
  /** Directory holding the static Next.js export. Skipped when absent (API-only, e.g. tests). */
  webRootDirectory?: string;
}

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** Builds (but does not start listening) the Nest application. Shared by the launcher and e2e tests. */
export async function createAiteamApplication(
  options: AiteamApplicationOptions,
): Promise<NestFastifyApplication> {
  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(options),
    new FastifyAdapter({ logger: false, bodyLimit: MAX_REQUEST_BODY_BYTES }),
    { logger: new NestLoggerAdapter(options.logger), abortOnError: false },
  );

  // QA documents are uploaded as raw bytes, one file per request (no multipart dependency).
  application
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: QA_DOCUMENT_MAX_BYTES },
      (_request: unknown, body: Buffer, done: (error: Error | null, body?: Buffer) => void) =>
        done(null, body),
    );

  if (options.webRootDirectory !== undefined) {
    if (existsSync(options.webRootDirectory)) {
      application.useStaticAssets({
        root: options.webRootDirectory,
        prefix: '/',
        index: ['index.html'],
        redirect: true,
      });
    } else {
      options.logger.warn(
        { webRootDirectory: options.webRootDirectory },
        'web build not found; serving API only (run npm run build)',
      );
    }
  }

  await application.init();
  await application.getHttpAdapter().getInstance().ready();
  return application;
}
