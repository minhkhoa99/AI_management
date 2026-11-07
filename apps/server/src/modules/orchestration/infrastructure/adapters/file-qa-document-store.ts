import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../../../app-runtime-config';
import type { QaDocumentStore } from '../../application/ports/qa-document-store.port';

/** ~/.aiteam/data/qa-documents/<taskId>/<attachmentId><ext>, private to the current user. */
@Injectable()
export class FileQaDocumentStore implements QaDocumentStore {
  private readonly rootDirectory: string;

  constructor(@Inject(APP_RUNTIME_CONFIG) runtimeConfig: AppRuntimeConfig) {
    this.rootDirectory = path.join(runtimeConfig.dataDirectory, 'qa-documents');
  }

  saveQaDocument(taskId: string, attachmentId: string, extension: string, content: Buffer): string {
    const taskDirectory = this.resolveInsideRoot(taskId);
    mkdirSync(taskDirectory, { recursive: true, mode: 0o700 });
    const contentPath = this.resolveInsideRoot(taskId, `${attachmentId}${extension}`);
    writeFileSync(contentPath, content, { mode: 0o600 });
    return contentPath;
  }

  removeQaDocument(contentPath: string): void {
    rmSync(this.resolveInsideRoot(path.relative(this.rootDirectory, contentPath)), {
      force: true,
    });
  }

  removeTaskDocuments(taskId: string): void {
    rmSync(this.resolveInsideRoot(taskId), { recursive: true, force: true, maxRetries: 3 });
  }

  /** Ids are validated upstream; this keeps any path strictly under the store's root anyway. */
  private resolveInsideRoot(...segments: string[]): string {
    const resolved = path.resolve(this.rootDirectory, ...segments);
    if (!resolved.startsWith(this.rootDirectory + path.sep)) {
      throw new RangeError(`QA document path escapes the store: ${segments.join('/')}`);
    }
    return resolved;
  }
}
