import { Inject, Injectable } from '@nestjs/common';
import type { AgentRole, WorkflowProposal } from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import type { EngineSnapshot } from '../../domain/entities/task';
import { interpretWorkflowProposal } from '../../domain/workflow-proposal';
import {
  buildWorkflowProposalPrompt,
  type WorkflowProposalMode,
} from '../../domain/workflow-proposal-prompt';
import {
  ONE_SHOT_AGENT_RUNNER,
  type OneShotAgentRunner,
  STAFF_DIRECTORY,
  type StaffAgent,
  type StaffDirectory,
} from '../ports/task-execution.ports';

/**
 * Asks one agent of the department (the chosen one, else the head, else the first available) to
 * draft or optimize a workflow, read-only and offline, one run per department at a time. Never
 * logs the goal, the prompt or the answer.
 */
@Injectable()
export class WorkflowProposalAuthor {
  constructor(
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    @Inject(ONE_SHOT_AGENT_RUNNER) private readonly agentRunner: OneShotAgentRunner,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  async writeWorkflowProposal(input: {
    departmentId: string;
    departmentName: string;
    agentId: string | undefined;
    mode: WorkflowProposalMode;
  }): Promise<Omit<WorkflowProposal, 'basedOnTaskCount'>> {
    const staff = this.staffDirectory.listDepartmentStaff(input.departmentId);
    const author = chooseProposalAuthor(staff, input.agentId);
    const engine = this.staffDirectory.readEngineSnapshot(author.agentId);
    if (engine === undefined) throw agentInvalid();
    const staffedRoles = [
      ...new Set(staff.filter((member) => member.available).map((member) => member.role)),
    ];
    const snapshot: EngineSnapshot = {
      agentId: engine.agentId,
      provider: engine.provider,
      connectionId: engine.connectionId,
      model: engine.model,
      accessLevel: 'read_only',
      networkAccess: false,
    };
    const answer = await this.agentRunner.askAgentOnce({
      snapshot,
      prompt: buildWorkflowProposalPrompt({
        departmentName: input.departmentName,
        staffedRoles,
        mode: input.mode,
      }),
      runKey: `workflow-ai:${input.departmentId}`,
    });
    const proposal = interpretWorkflowProposal({
      finalText: answer,
      currentStepIds: input.mode.kind === 'optimize' ? input.mode.steps.map((step) => step.id) : [],
      staffedRoles: new Set<AgentRole>(staffedRoles),
    });
    this.logger.info(
      {
        departmentId: input.departmentId,
        agentId: author.agentId,
        mode: input.mode.kind,
        answerLength: answer.length,
      },
      'workflow proposal written',
    );
    return proposal;
  }
}

function chooseProposalAuthor(
  staff: readonly StaffAgent[],
  agentId: string | undefined,
): StaffAgent {
  if (agentId !== undefined) {
    const chosen = staff.find((member) => member.agentId === agentId && member.available);
    if (chosen === undefined) throw agentInvalid();
    return chosen;
  }
  const head = staff.find((member) => member.reportsToPositionId === null && member.available);
  const author = head ?? staff.find((member) => member.available);
  if (author === undefined) {
    throw new ValidationError('Phòng chưa có agent nào đang bật.', {
      code: 'DEPARTMENT_HAS_NO_AVAILABLE_AGENT',
    });
  }
  return author;
}

function agentInvalid(): ValidationError {
  return new ValidationError('Agent phải thuộc phòng và đang bật.', {
    code: 'WORKFLOW_AI_AGENT_INVALID',
  });
}
