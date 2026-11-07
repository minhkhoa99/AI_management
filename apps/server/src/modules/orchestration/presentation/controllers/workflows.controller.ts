import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  type CreateWorkflowRequest,
  createWorkflowRequestSchema,
  entityIdSchema,
  type ReplaceWorkflowStepsRequest,
  replaceWorkflowStepsRequestSchema,
  type SetDefaultWorkflowRequest,
  setDefaultWorkflowRequestSchema,
  type UpdateWorkflowRequest,
  updateWorkflowRequestSchema,
  type UpdateWorkflowRulesRequest,
  updateWorkflowRulesRequestSchema,
  type Workflow,
  type WorkflowTemplate,
} from '@aiteam/contracts';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { CreateWorkflowUseCase } from '../../application/use-cases/create-workflow.use-case';
import { DeleteWorkflowUseCase } from '../../application/use-cases/delete-workflow.use-case';
import { DuplicateWorkflowUseCase } from '../../application/use-cases/duplicate-workflow.use-case';
import { ListWorkflowTemplatesUseCase } from '../../application/use-cases/list-workflow-templates.use-case';
import { ListWorkflowsUseCase } from '../../application/use-cases/list-workflows.use-case';
import { ReplaceWorkflowStepsUseCase } from '../../application/use-cases/replace-workflow-steps.use-case';
import { SetDefaultWorkflowUseCase } from '../../application/use-cases/set-default-workflow.use-case';
import { UpdateWorkflowRulesUseCase } from '../../application/use-cases/update-workflow-rules.use-case';
import { UpdateWorkflowUseCase } from '../../application/use-cases/update-workflow.use-case';

const departmentIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã phòng ban');
const workflowIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã quy trình');

@Controller('api')
export class WorkflowsController {
  constructor(
    private readonly listWorkflowsUseCase: ListWorkflowsUseCase,
    private readonly listWorkflowTemplatesUseCase: ListWorkflowTemplatesUseCase,
    private readonly createWorkflowUseCase: CreateWorkflowUseCase,
    private readonly updateWorkflowUseCase: UpdateWorkflowUseCase,
    private readonly duplicateWorkflowUseCase: DuplicateWorkflowUseCase,
    private readonly setDefaultWorkflowUseCase: SetDefaultWorkflowUseCase,
    private readonly deleteWorkflowUseCase: DeleteWorkflowUseCase,
    private readonly replaceWorkflowStepsUseCase: ReplaceWorkflowStepsUseCase,
    private readonly updateWorkflowRulesUseCase: UpdateWorkflowRulesUseCase,
  ) {}

  @Get('workflow-templates')
  listWorkflowTemplates(): readonly WorkflowTemplate[] {
    return this.listWorkflowTemplatesUseCase.listWorkflowTemplates();
  }

  @Get('departments/:departmentId/workflows')
  listWorkflows(@Param('departmentId', departmentIdPipe) departmentId: string): Workflow[] {
    return this.listWorkflowsUseCase.listWorkflows(departmentId);
  }

  @Post('departments/:departmentId/workflows')
  createWorkflow(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Body(new ZodRequestPipe(createWorkflowRequestSchema)) request: CreateWorkflowRequest,
  ): Workflow {
    return this.createWorkflowUseCase.createWorkflow(departmentId, request);
  }

  @Put('departments/:departmentId/default-workflow')
  setDefaultWorkflow(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Body(new ZodRequestPipe(setDefaultWorkflowRequestSchema)) request: SetDefaultWorkflowRequest,
  ): Workflow {
    return this.setDefaultWorkflowUseCase.setDefaultWorkflow(departmentId, request.workflowId);
  }

  @Patch('workflows/:workflowId')
  updateWorkflow(
    @Param('workflowId', workflowIdPipe) workflowId: string,
    @Body(new ZodRequestPipe(updateWorkflowRequestSchema)) request: UpdateWorkflowRequest,
  ): Workflow {
    return this.updateWorkflowUseCase.updateWorkflow(workflowId, request);
  }

  @Post('workflows/:workflowId/duplicates')
  duplicateWorkflow(@Param('workflowId', workflowIdPipe) workflowId: string): Workflow {
    return this.duplicateWorkflowUseCase.duplicateWorkflow(workflowId);
  }

  @Delete('workflows/:workflowId')
  @HttpCode(204)
  deleteWorkflow(@Param('workflowId', workflowIdPipe) workflowId: string): void {
    this.deleteWorkflowUseCase.deleteWorkflow(workflowId);
  }

  @Put('workflows/:workflowId/steps')
  replaceWorkflowSteps(
    @Param('workflowId', workflowIdPipe) workflowId: string,
    @Body(new ZodRequestPipe(replaceWorkflowStepsRequestSchema))
    request: ReplaceWorkflowStepsRequest,
  ): Workflow {
    return this.replaceWorkflowStepsUseCase.replaceWorkflowSteps(workflowId, request);
  }

  @Patch('workflows/:workflowId/rules')
  updateWorkflowRules(
    @Param('workflowId', workflowIdPipe) workflowId: string,
    @Body(new ZodRequestPipe(updateWorkflowRulesRequestSchema))
    request: UpdateWorkflowRulesRequest,
  ): Workflow {
    return this.updateWorkflowRulesUseCase.updateWorkflowRules(workflowId, request);
  }
}
