import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../../shared/errors/app-error';
import {
  TASK_ATTACHMENT_REPOSITORY,
  type TaskAttachmentRepository,
} from '../../domain/repositories/task-attachment.repository';
import { QA_DOCUMENT_STORE, type QaDocumentStore } from '../ports/qa-document-store.port';

@Injectable()
export class RemoveQaDocumentUseCase {
  constructor(
    @Inject(TASK_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: TaskAttachmentRepository,
    @Inject(QA_DOCUMENT_STORE) private readonly documentStore: QaDocumentStore,
  ) {}

  removeQaDocument(taskId: string, attachmentId: string): void {
    const attachment = this.attachmentRepository
      .listAttachments(taskId)
      .find((candidate) => candidate.id === attachmentId);
    if (attachment === undefined) {
      throw new NotFoundError('Không tìm thấy tài liệu QA.', { code: 'QA_DOCUMENT_NOT_FOUND' });
    }
    this.attachmentRepository.deleteAttachment(attachment.id);
    this.documentStore.removeQaDocument(attachment.contentPath);
  }
}
