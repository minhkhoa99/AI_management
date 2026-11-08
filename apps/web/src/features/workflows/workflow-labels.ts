import type { StepFailureAction, StepGate, StepOwner, WorkflowRules } from '@aiteam/contracts';
import { ROLE_LABELS } from '../organization/organization-labels';

/** Gate names and pill colours from the design mockup. */
export const GATE_PRESENTATION: Record<
  StepGate,
  { label: string; background: string; foreground: string }
> = {
  auto: { label: 'Tự động chuyển', background: '#1C2438', foreground: '#C5D0E3' },
  tests_pass: { label: 'Test tự động phải pass', background: '#113329', foreground: '#86E8C4' },
  qc_pass: { label: 'QC phải đạt', background: '#3A2E10', foreground: '#F9DA8B' },
  lead_approval: { label: 'Cấp trên duyệt', background: '#16305A', foreground: '#BFD8FF' },
  user_approval: { label: 'Bạn duyệt', background: '#3A2010', foreground: '#FDBA8C' },
};

export const FAILURE_ACTION_LABELS: Record<StepFailureAction, string> = {
  retry: 'Thử lại cùng bước',
  return_to_step: 'Quay lại một bước trước',
  stop: 'Dừng và báo quản lý',
};

export const STEP_OWNER_LABELS: Record<StepOwner, string> = {
  ...ROLE_LABELS,
  user: 'Bạn (người dùng)',
};

export const RULE_PRESENTATION: ReadonlyArray<{
  key: keyof WorkflowRules;
  label: string;
  description: string;
}> = [
  {
    key: 'noSkippingSteps',
    label: 'Không được bỏ qua bước',
    description: 'Task đi đủ các bước theo đúng thứ tự, kể cả khi bạn chuyển tay',
  },
  {
    key: 'sensitiveActionsNeedApproval',
    label: 'Việc nhạy cảm luôn cần bạn duyệt',
    description: 'Xoá dữ liệu, chi tiền, đăng công khai, deploy: agent dừng và chờ bạn',
  },
  {
    key: 'allowAgentSubsteps',
    label: 'Cho phép agent tách task con',
    description:
      'Agent có cấp dưới được chia phần việc thành task con cho cấp dưới làm song song; xong thì code được gộp lại',
  },
];
