import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type Approval,
  approvalListQuerySchema,
  type DecideApprovalRequest,
  decideApprovalRequestSchema,
  entityIdSchema,
} from '@aiteam/contracts';
import type { z } from 'zod';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { DecideApprovalUseCase } from '../../application/use-cases/decide-approval.use-case';
import { ListApprovalsUseCase } from '../../application/use-cases/list-approvals.use-case';

@Controller('api/approvals')
export class ApprovalsController {
  constructor(
    private readonly listApprovalsUseCase: ListApprovalsUseCase,
    private readonly decideApprovalUseCase: DecideApprovalUseCase,
  ) {}

  @Get()
  listApprovals(
    @Query(new ZodRequestPipe(approvalListQuerySchema, 'Bộ lọc'))
    query: z.infer<typeof approvalListQuerySchema>,
  ): Approval[] {
    return this.listApprovalsUseCase.listApprovals(query.status);
  }

  @Post(':approvalId/decision')
  @HttpCode(200)
  decideApproval(
    @Param('approvalId', new ZodRequestPipe(entityIdSchema, 'Mã yêu cầu duyệt')) approvalId: string,
    @Body(new ZodRequestPipe(decideApprovalRequestSchema)) request: DecideApprovalRequest,
  ): Approval {
    return this.decideApprovalUseCase.decideApproval(approvalId, request);
  }
}
