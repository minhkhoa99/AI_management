import { Injectable } from '@nestjs/common';
import type { WorkflowTemplate } from '@aiteam/contracts';
import { WORKFLOW_TEMPLATES } from '../../domain/workflow-templates';

@Injectable()
export class ListWorkflowTemplatesUseCase {
  listWorkflowTemplates(): readonly WorkflowTemplate[] {
    return WORKFLOW_TEMPLATES;
  }
}
