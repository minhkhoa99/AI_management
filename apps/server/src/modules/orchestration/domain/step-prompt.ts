import type { CompletionGoal, StepGate } from '@aiteam/contracts';

export interface StepPromptInput {
  taskCode: string;
  title: string;
  description: string;
  goal: CompletionGoal;
  /** QA documents copied into the worktree, relative to the agent's folder. */
  qaDocumentPaths: readonly string[];
  /** null: no workflow (or not enforced), the assignee does the whole task. */
  step: {
    name: string;
    number: number;
    count: number;
    gate: StepGate;
    requiredOutput: string;
  } | null;
  agentRoleLabel: string;
  previousReports: ReadonlyArray<{ stepName: string; agentName: string; summary: string }>;
  feedback: string | null;
  sensitiveActionsNeedApproval: boolean;
  allowAgentSubsteps: boolean;
  canEditWorkspace: boolean;
}

/**
 * The example shows the outcome the agent is expected to use: a model copies the example, so a
 * reviewer shown "done" answered "done" instead of "pass" (found in a real run).
 */
function describeReportFormat(exampleOutcome: 'done' | 'pass'): string {
  return `Kết thúc câu trả lời cuối cùng bằng đúng một khối báo cáo (JSON hợp lệ, không thêm gì sau nó):
<aiteam-report>{"outcome": "${exampleOutcome}", "summary": "tóm tắt việc đã làm và đầu ra", "approvalRequest": null}</aiteam-report>`;
}

/** The prompt of one agent turn: task, completion goal, the step's duty and the report format. */
export function buildStepPrompt(input: StepPromptInput): string {
  const sections: string[] = [];
  sections.push(
    `Bạn là ${input.agentRoleLabel} trong một nhóm AI. Task ${input.taskCode}: ${input.title}`,
  );
  if (input.description.trim() !== '') {
    sections.push(`Mô tả:\n${input.description.trim()}`);
  }
  sections.push(describeGoal(input.goal, input.qaDocumentPaths));

  if (input.step === null) {
    sections.push('Bạn tự thực hiện toàn bộ task này, theo thứ tự bạn thấy hợp lý.');
  } else {
    sections.push(
      [
        `Quy trình: bạn phụ trách bước ${input.step.number}/${input.step.count} "${input.step.name}".`,
        input.step.requiredOutput.trim() === ''
          ? 'Chỉ làm phần việc của bước này; các bước sau do người khác làm.'
          : `Đầu ra bắt buộc của bước: ${input.step.requiredOutput.trim()}. Chỉ báo xong khi có đủ đầu ra này; các bước sau do người khác làm.`,
        describeGateDuty(input.step.gate),
      ].join('\n'),
    );
  }
  if (input.previousReports.length > 0) {
    sections.push(
      `Kết quả các bước trước:\n${input.previousReports
        .map((report) => `- ${report.stepName} (${report.agentName}): ${report.summary}`)
        .join('\n')}`,
    );
  }
  if (input.feedback !== null && input.feedback.trim() !== '') {
    sections.push(`Phản hồi cần xử lý trong lượt này:\n${input.feedback.trim()}`);
  }

  const rules: string[] = [
    input.canEditWorkspace
      ? 'Chỉ đọc và sửa file trong thư mục hiện tại (một git worktree riêng của task). Không push, không đổi nhánh.'
      : 'Bạn chỉ có quyền đọc: không sửa, tạo hay xoá file.',
  ];
  if (input.sensitiveActionsNeedApproval) {
    rules.push(
      'Việc nhạy cảm (xoá dữ liệu, chi tiền, đăng công khai, deploy, gửi thông tin ra ngoài) phải được người dùng duyệt: KHÔNG làm, mà dừng lại với outcome "needs_approval" và mô tả việc định làm trong approvalRequest.',
    );
  }
  if (input.allowAgentSubsteps) {
    rules.push(
      'Bạn được chia nhỏ bước thành các bước phụ, nhưng phải liệt kê chúng trong summary.',
    );
  }
  sections.push(`Quy tắc:\n${rules.map((rule) => `- ${rule}`).join('\n')}`);
  const gate = input.step?.gate ?? null;
  sections.push(
    `${describeOutcomes(gate)}\n${describeReportFormat(gate === 'qc_pass' ? 'pass' : 'done')}`,
  );
  return sections.join('\n\n');
}

/** Prompt for the superior who reviews a step ("Cấp trên duyệt"). Always read-only. */
export function buildReviewPrompt(input: {
  taskCode: string;
  title: string;
  goal: CompletionGoal;
  stepName: string;
  requiredOutput: string;
  workerName: string;
  workerSummary: string;
  reviewerRoleLabel: string;
}): string {
  return [
    `Bạn là ${input.reviewerRoleLabel}, cấp trên duyệt kết quả bước "${input.stepName}" của task ${input.taskCode}: ${input.title}.`,
    describeGoal(input.goal, []),
    input.requiredOutput.trim() === ''
      ? ''
      : `Đầu ra bắt buộc của bước: ${input.requiredOutput.trim()}`,
    `${input.workerName} báo cáo:\n${input.workerSummary}`,
    'Kiểm tra thực tế trong thư mục hiện tại (file, git log, git diff). Bạn chỉ có quyền đọc.',
    'Trả outcome "pass" nếu đạt; "fail" nếu chưa đạt, kèm điều cần sửa cụ thể trong summary.',
    describeReportFormat('pass'),
  ]
    .filter((section) => section !== '')
    .join('\n\n');
}

function describeGoal(goal: CompletionGoal, qaDocumentPaths: readonly string[]): string {
  const lines = [goal.title, ...goal.items.map((item) => `- ${item}`)];
  if (qaDocumentPaths.length > 0) {
    lines.push(`Tài liệu QA (đọc kỹ, đây là đích): ${qaDocumentPaths.join(', ')}`);
  }
  return lines.join('\n');
}

function describeGateDuty(gate: StepGate): string {
  switch (gate) {
    case 'auto':
      return 'Bước tự chuyển tiếp khi bạn báo xong.';
    case 'tests_pass':
      return 'Sau bước này nền tảng chạy lệnh kiểm thử của task; bước chỉ đạt khi test pass. Hãy tự chạy test trước khi báo xong.';
    case 'qc_pass':
      return 'Bạn là người kiểm tra: đối chiếu kết quả với đích hoàn thành và trả "pass" hoặc "fail".';
    case 'lead_approval':
      return 'Cấp trên của bạn sẽ duyệt kết quả bước này.';
    case 'user_approval':
      return 'Người dùng sẽ duyệt kết quả bước này.';
  }
}

function describeOutcomes(gate: StepGate | null): string {
  return gate === 'qc_pass'
    ? 'outcome: "pass" nếu đạt đích, "fail" nếu không (ghi rõ lỗi trong summary), "needs_approval" nếu cần người dùng duyệt.'
    : 'outcome: "done" khi xong phần việc, "fail" nếu không thể hoàn thành (giải thích trong summary), "needs_approval" nếu cần người dùng duyệt.';
}
