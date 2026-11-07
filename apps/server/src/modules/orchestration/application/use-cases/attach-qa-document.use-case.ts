import { Inject, Injectable } from '@nestjs/common';
import {
  countQaTestCases,
  isCountableQaDocument,
  QA_DOCUMENT_MAX_BYTES,
  QA_DOCUMENTS_PER_TASK_MAX,
  readFileExtension,
  type TaskAttachment,
} from '@aiteam/contracts';
import { ConflictError, ValidationError } from '../../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import {
  TASK_ATTACHMENT_REPOSITORY,
  type TaskAttachmentRepository,
} from '../../domain/repositories/task-attachment.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { QA_DOCUMENT_STORE, type QaDocumentStore } from '../ports/qa-document-store.port';
import { requireTaskExists } from './get-task-detail.use-case';

/**
 * Stores a QA document of a task. Text formats are counted for test cases right away; a file
 * with the same name replaces the earlier one.
 */
@Injectable()
export class AttachQaDocumentUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: TaskAttachmentRepository,
    @Inject(QA_DOCUMENT_STORE) private readonly documentStore: QaDocumentStore,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  attachQaDocument(taskId: string, fileName: string, content: Buffer): TaskAttachment {
    requireTaskExists(this.taskRepository, taskId);
    if (content.length === 0 || content.length > QA_DOCUMENT_MAX_BYTES) {
      throw new ValidationError(
        `File phải có nội dung và nhỏ hơn ${QA_DOCUMENT_MAX_BYTES / 1024 / 1024} MB.`,
        { code: 'QA_DOCUMENT_SIZE_INVALID' },
      );
    }
    const existing = this.attachmentRepository.listAttachments(taskId);
    // Case-insensitive: Spec.md and spec.md are the same file in .aiteam-qa on Windows and macOS.
    const replaced = existing.find(
      (attachment) => attachment.fileName.toLowerCase() === fileName.toLowerCase(),
    );
    if (replaced === undefined && existing.length >= QA_DOCUMENTS_PER_TASK_MAX) {
      throw new ConflictError(`Mỗi task tối đa ${QA_DOCUMENTS_PER_TASK_MAX} tài liệu QA.`, {
        code: 'QA_DOCUMENT_LIMIT_REACHED',
      });
    }

    const attachmentId = this.idGenerator.generateId();
    const contentPath = this.documentStore.saveQaDocument(
      taskId,
      attachmentId,
      readFileExtension(fileName),
      content,
    );
    const attachment = {
      id: attachmentId,
      taskId,
      fileName,
      size: content.length,
      contentPath,
      detectedCases: isCountableQaDocument(fileName)
        ? countQaTestCases(content.toString('utf8'), fileName)
        : null,
    };
    this.attachmentRepository.insertAttachment(attachment);
    if (replaced !== undefined) {
      this.attachmentRepository.deleteAttachment(replaced.id);
      this.documentStore.removeQaDocument(replaced.contentPath);
    }
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      size: attachment.size,
      detectedCases: attachment.detectedCases,
    };
  }
}
