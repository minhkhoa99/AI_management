export const QA_DOCUMENT_STORE = Symbol('QA_DOCUMENT_STORE');

/** Bytes of QA documents live as files under the data directory; the database keeps the path. */
export interface QaDocumentStore {
  /** Returns the stored file's path. The file name never comes from the user. */
  saveQaDocument(taskId: string, attachmentId: string, extension: string, content: Buffer): string;
  removeQaDocument(contentPath: string): void;
  removeTaskDocuments(taskId: string): void;
}
