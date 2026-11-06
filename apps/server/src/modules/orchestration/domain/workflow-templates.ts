import type {
  StepFailureAction,
  StepGate,
  StepOwner,
  WorkflowTemplate,
  WorkflowTemplateId,
} from '@aiteam/contracts';
import type { WorkflowStepBlueprint } from './entities/workflow';

function step(
  name: string,
  ownerRole: StepOwner,
  gate: StepGate,
  failure: { onFail: StepFailureAction; returnToStepIndex?: number; maxRetries?: number },
  requiredOutput: string,
): WorkflowStepBlueprint {
  return {
    name,
    ownerRole,
    gate,
    onFail: failure.onFail,
    returnToStepIndex: failure.returnToStepIndex ?? null,
    maxRetries: failure.maxRetries ?? 0,
    requiredOutput,
  };
}

const STOP = { onFail: 'stop' } as const;
const retry = (maxRetries: number) => ({ onFail: 'retry', maxRetries }) as const;
const returnTo = (returnToStepIndex: number) =>
  ({ onFail: 'return_to_step', returnToStepIndex }) as const;

/** Built-in templates (from the design mockup). Constants, not stored in the database. */
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'software',
    label: 'Phát triển phần mềm',
    steps: [
      step(
        'Tiếp nhận và lập kế hoạch',
        'manager',
        'auto',
        STOP,
        'Kế hoạch có mục tiêu, phạm vi, rủi ro',
      ),
      step('Chia task', 'pm', 'lead_approval', returnTo(0), 'Mỗi task có tiêu chí nghiệm thu'),
      step('Phát triển', 'dev', 'tests_pass', retry(3), 'Code, test tự động, mô tả thay đổi'),
      step('Kiểm thử', 'qc', 'qc_pass', returnTo(2), 'Báo cáo kiểm thử, danh sách lỗi'),
      step('Review', 'pm', 'lead_approval', returnTo(2), 'Đối chiếu tiêu chí nghiệm thu'),
      step('Duyệt phát hành', 'user', 'user_approval', returnTo(1), 'Ghi chú phát hành'),
    ],
  },
  {
    id: 'content',
    label: 'Sản xuất nội dung',
    steps: [
      step('Nhận brief', 'manager', 'auto', STOP, 'Mục tiêu, đối tượng, kênh đăng'),
      step('Nghiên cứu từ khoá', 'analyst', 'auto', retry(2), 'Danh sách từ khoá ưu tiên'),
      step('Viết nội dung', 'writer', 'lead_approval', retry(2), 'Bản nháp đủ cấu trúc'),
      step('Kiểm tra SEO', 'analyst', 'qc_pass', returnTo(2), 'Điểm SEO và góp ý sửa'),
      step('Duyệt đăng', 'user', 'user_approval', returnTo(2), 'Bản cuối đã duyệt'),
      step('Đăng và đo lường', 'writer', 'auto', STOP, 'Link bài, số liệu sau 7 ngày'),
    ],
  },
  {
    id: 'hotfix',
    label: 'Sửa lỗi khẩn',
    steps: [
      step('Tiếp nhận lỗi', 'pm', 'auto', STOP, 'Mô tả lỗi, cách tái hiện, mức ảnh hưởng'),
      step('Sửa lỗi', 'dev', 'tests_pass', retry(2), 'Bản sửa kèm test tái hiện lỗi'),
      step('Kiểm thử', 'qc', 'qc_pass', returnTo(1), 'Lỗi đã hết, không phát sinh lỗi mới'),
      step('Bạn duyệt deploy', 'user', 'user_approval', returnTo(1), 'Ghi chú bản vá'),
    ],
  },
  {
    id: 'ticket',
    label: 'Xử lý ticket',
    steps: [
      step('Tiếp nhận ticket', 'support', 'auto', retry(2), 'Ticket đã phân loại'),
      step('Ưu tiên và hạn SLA', 'support', 'auto', retry(1), 'Mức ưu tiên, hạn xử lý'),
      step('Xử lý', 'support', 'tests_pass', retry(2), 'Câu trả lời hoặc thao tác đã làm'),
      step(
        'Duyệt việc nhạy cảm',
        'user',
        'user_approval',
        returnTo(2),
        'Chỉ khi hoàn tiền hoặc xoá dữ liệu',
      ),
      step('Đóng ticket', 'support', 'auto', STOP, 'Khảo sát hài lòng đã gửi'),
      step('Báo cáo SLA', 'manager', 'lead_approval', STOP, 'Báo cáo tuần'),
    ],
  },
];

/** "Trống (2 bước)": the head does the work, then the user approves. */
export const BLANK_WORKFLOW_STEPS: readonly WorkflowStepBlueprint[] = [
  step('Thực hiện', 'manager', 'auto', STOP, ''),
  step('Bạn duyệt', 'user', 'user_approval', returnTo(0), 'Kết quả đã được duyệt'),
];

export function findWorkflowTemplate(templateId: WorkflowTemplateId): WorkflowTemplate {
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (template === undefined) {
    throw new RangeError(`Unknown workflow template ${templateId}`);
  }
  return template;
}
