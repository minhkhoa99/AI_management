'use client';

import { type FormEvent, useState } from 'react';
import {
  type AgentSummary,
  draftWorkflowStepsRequestSchema,
  WORKFLOW_GOAL_MAX_LENGTH,
  type WorkflowProposal,
} from '@aiteam/contracts';
import { controlStyles, InlinePanel, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { draftWorkflowSteps, proposeWorkflowOptimization } from '../workflows-api';
import styles from './workflows.module.css';

export type WorkflowAiMode = 'draft' | 'optimize';

interface WorkflowAiPanelProps {
  mode: WorkflowAiMode;
  departmentId: string;
  workflowId: string;
  departmentAgents: readonly AgentSummary[];
  onProposal: (proposal: WorkflowProposal) => void;
  onClose: () => void;
}

const DEFAULT_AGENT = '';

/** Asks an agent of the department to draft steps from a goal, or to optimize this workflow. */
export function WorkflowAiPanel({
  mode,
  departmentId,
  workflowId,
  departmentAgents,
  onProposal,
  onClose,
}: WorkflowAiPanelProps) {
  const [goal, setGoal] = useState('');
  const [agentChoice, setAgentChoice] = useState(DEFAULT_AGENT);
  const [goalError, setGoalError] = useState<string | null>(null);
  const { outcome, isPending, performAction } = useActionOutcome();
  const agentId = agentChoice === DEFAULT_AGENT ? undefined : agentChoice;

  const askForProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let requestProposal: () => Promise<WorkflowProposal>;
    if (mode === 'draft') {
      const parsed = draftWorkflowStepsRequestSchema.safeParse({ goal, agentId });
      if (!parsed.success) {
        setGoalError(parsed.error.issues[0]?.message ?? 'Nhập mục tiêu cho quy trình.');
        return;
      }
      requestProposal = () => draftWorkflowSteps(departmentId, parsed.data);
    } else {
      requestProposal = () => proposeWorkflowOptimization(workflowId, { agentId });
    }
    setGoalError(null);
    const proposal = await performAction(requestProposal, () => null);
    if (proposal !== undefined) onProposal(proposal);
  };

  return (
    <InlinePanel title={mode === 'draft' ? 'AI soạn bước' : 'AI tối ưu quy trình'} emphasised>
      <form onSubmit={(event) => void askForProposal(event)} className={styles.formStack}>
        {mode === 'draft' ? (
          <label className={controlStyles.field}>
            Mục tiêu (gõ hoặc dán mô tả quy trình bạn muốn)
            <textarea
              value={goal}
              maxLength={WORKFLOW_GOAL_MAX_LENGTH}
              rows={6}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Mỗi tuần viết một bài blog: lên dàn ý, viết, biên tập, tôi duyệt trước khi đăng"
              className={styles.textInput}
              aria-invalid={goalError !== null}
            />
          </label>
        ) : (
          <p className={styles.mutedText}>
            AI đọc số liệu các task gần đây chạy theo quy trình này rồi đề xuất thêm, bớt, gộp hoặc
            đổi thứ tự bước.
          </p>
        )}
        {goalError !== null && (
          <span role="alert" className={controlStyles.fieldError}>
            {goalError}
          </span>
        )}
        <label className={controlStyles.field}>
          Agent soạn
          <select
            value={agentChoice}
            onChange={(event) => setAgentChoice(event.target.value)}
            className={controlStyles.fieldInput}
          >
            <option value={DEFAULT_AGENT}>Trưởng phòng (mặc định)</option>
            {departmentAgents
              .filter((agent) => agent.enabled)
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
          </select>
        </label>
        {isPending && (
          <p role="status" className={styles.mutedText}>
            AI đang soạn (tối đa 3 phút)
          </p>
        )}
        <StatusNotice outcome={outcome} />
        <div className={controlStyles.buttonRow}>
          <button type="submit" className={controlStyles.primaryButton} disabled={isPending}>
            {mode === 'draft' ? 'Soạn bước' : 'Đề xuất tối ưu'}
          </button>
          <button type="button" className={controlStyles.secondaryButton} onClick={onClose}>
            Đóng
          </button>
        </div>
      </form>
    </InlinePanel>
  );
}
