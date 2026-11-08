import { describe, expect, it } from 'vitest';
import { interpretAgentReport } from './agent-report';
import type { WorkflowStepState } from './entities/workflow';
import { chooseStepAgent, findSuperior, type StaffMember } from './step-assignee';
import { decideNextStep } from './step-progression';
import { buildReviewPrompt, buildStepPrompt } from './step-prompt';

describe('interpretAgentReport', () => {
  it('reads the last well-formed report block', () => {
    const text = [
      'Ví dụ cũ <aiteam-report>{"outcome":"fail","summary":"x"}</aiteam-report>',
      'Xong rồi.',
      '<aiteam-report>{"outcome":"pass","summary":"Đạt 14/14 kịch bản"}</aiteam-report>',
    ].join('\n');

    expect(interpretAgentReport(text)).toEqual({
      outcome: 'pass',
      summary: 'Đạt 14/14 kịch bản',
      approvalRequest: null,
      wellFormed: true,
      subtasks: [],
    });
  });

  it('keeps valid subtasks only, at most five, whatever else the agent wrote', () => {
    const subtasks = [
      { title: 'API đăng nhập', description: 'POST /login', assignee: 'Dev backend' },
      { title: '   ' },
      { description: 'thiếu tiêu đề' },
      'không phải object',
      ...Array.from({ length: 6 }, (_unused, index) => ({ title: `Phần ${index + 1}` })),
    ];

    const report = interpretAgentReport(
      `<aiteam-report>${JSON.stringify({ outcome: 'done', summary: 'chia việc', subtasks })}</aiteam-report>`,
    );

    expect(report.wellFormed).toBe(true);
    expect(report.subtasks).toEqual([
      { title: 'API đăng nhập', description: 'POST /login', assignee: 'Dev backend' },
      { title: 'Phần 1', description: '', assignee: null },
      { title: 'Phần 2', description: '', assignee: null },
      { title: 'Phần 3', description: '', assignee: null },
      { title: 'Phần 4', description: '', assignee: null },
    ]);
  });

  it('keeps the approval request only when approval is asked', () => {
    const report = interpretAgentReport(
      '<aiteam-report>{"outcome":"needs_approval","summary":"cần deploy","approvalRequest":"deploy lên prod"}</aiteam-report>',
    );

    expect(report).toMatchObject({ outcome: 'needs_approval', approvalRequest: 'deploy lên prod' });
  });

  it.each([
    ['no block', 'Tôi đã làm xong.'],
    ['broken JSON', '<aiteam-report>{outcome: pass}</aiteam-report>'],
    ['unknown outcome', '<aiteam-report>{"outcome":"approve","summary":"x"}</aiteam-report>'],
    ['no text at all', null],
  ])('treats %s as "done" without a verdict', (_label, text) => {
    expect(interpretAgentReport(text)).toMatchObject({ outcome: 'done', wellFormed: false });
  });
});

function step(id: string, overrides: Partial<WorkflowStepState> = {}): WorkflowStepState {
  return {
    id,
    name: id,
    ownerRole: 'dev',
    gate: 'auto',
    onFail: 'stop',
    returnToStepId: null,
    maxRetries: 0,
    requiredOutput: '',
    ...overrides,
  };
}

describe('decideNextStep', () => {
  const steps = [
    step('plan'),
    step('code', { onFail: 'retry', maxRetries: 2 }),
    step('test', { onFail: 'return_to_step', returnToStepId: 'code' }),
  ];

  it('advances on a pass and finishes after the last step', () => {
    expect(decideNextStep(steps, 'plan', true, 0)).toEqual({ kind: 'advance', nextStepId: 'code' });
    expect(decideNextStep(steps, 'test', true, 0)).toEqual({ kind: 'advance', nextStepId: null });
  });

  it('retries while retries are left, then stops', () => {
    expect(decideNextStep(steps, 'code', false, 0)).toEqual({ kind: 'retry_step' });
    expect(decideNextStep(steps, 'code', false, 1)).toEqual({ kind: 'retry_step' });
    expect(decideNextStep(steps, 'code', false, 2)).toMatchObject({ kind: 'stop' });
  });

  it('returns to the target step, and stops for "stop" or an unknown step', () => {
    expect(decideNextStep(steps, 'test', false, 0)).toEqual({
      kind: 'return_to_step',
      stepId: 'code',
    });
    expect(decideNextStep(steps, 'plan', false, 0)).toMatchObject({ kind: 'stop' });
    expect(decideNextStep(steps, 'gone', true, 0)).toMatchObject({ kind: 'stop' });
  });
});

describe('chooseStepAgent', () => {
  // Manager ─┬─ PM ─┬─ Dev A
  //          │      └─ Dev B
  //          └─ Lead2 ── Dev C
  const staff: StaffMember[] = [
    {
      agentId: 'manager',
      role: 'manager',
      available: true,
      positionId: 'p0',
      reportsToPositionId: null,
    },
    { agentId: 'pm', role: 'pm', available: true, positionId: 'p1', reportsToPositionId: 'p0' },
    { agentId: 'dev-a', role: 'dev', available: true, positionId: 'p2', reportsToPositionId: 'p1' },
    { agentId: 'dev-b', role: 'dev', available: true, positionId: 'p3', reportsToPositionId: 'p1' },
    { agentId: 'lead2', role: 'pm', available: true, positionId: 'p4', reportsToPositionId: 'p0' },
    { agentId: 'dev-c', role: 'dev', available: true, positionId: 'p5', reportsToPositionId: 'p4' },
  ];

  it('keeps the assignee when it has the role', () => {
    expect(
      chooseStepAgent({
        role: 'dev',
        staff,
        currentAssigneeId: 'dev-b',
        activeTaskCountByAgent: new Map(),
      }),
    ).toBe('dev-b');
  });

  it('prefers the assignee team, least busy first', () => {
    expect(
      chooseStepAgent({
        role: 'dev',
        staff,
        currentAssigneeId: 'pm',
        activeTaskCountByAgent: new Map([['dev-a', 2]]),
      }),
    ).toBe('dev-b');
    expect(
      chooseStepAgent({
        role: 'dev',
        staff,
        currentAssigneeId: 'lead2',
        activeTaskCountByAgent: new Map(),
      }),
    ).toBe('dev-c');
  });

  it('falls back to the department, and returns null when nobody available has the role', () => {
    const devsOff = staff.map((member) =>
      member.agentId === 'dev-c' ? member : { ...member, available: member.role !== 'dev' },
    );
    expect(
      chooseStepAgent({
        role: 'dev',
        staff: devsOff,
        currentAssigneeId: 'pm',
        activeTaskCountByAgent: new Map(),
      }),
    ).toBe('dev-c');
    expect(
      chooseStepAgent({
        role: 'qc',
        staff,
        currentAssigneeId: 'pm',
        activeTaskCountByAgent: new Map(),
      }),
    ).toBeNull();
  });

  it('finds the superior; the head has none', () => {
    expect(findSuperior('dev-a', staff)?.agentId).toBe('pm');
    expect(findSuperior('manager', staff)).toBeNull();
  });
});

describe('buildStepPrompt', () => {
  const base = {
    taskCode: 'T-7',
    title: 'API đăng nhập',
    description: 'Dùng JWT',
    goal: {
      source: 'description' as const,
      title: 'Đích',
      summary: '',
      note: '',
      items: ['Sai mật khẩu trả 401'],
    },
    qaDocumentPaths: ['.aiteam-qa/login.md'],
    agentRoleLabel: 'Dev Dev backend',
    previousReports: [{ stepName: 'Chia task', agentName: 'PM Linh', summary: 'Chia 3 việc' }],
    feedback: 'TC-03 còn lỗi',
    splitCandidates: [],
    subtaskOf: null,
    skills: [],
  };

  it('states the step duty, previous results, feedback, rules and the report format', () => {
    const prompt = buildStepPrompt({
      ...base,
      step: {
        name: 'Phát triển',
        number: 3,
        count: 6,
        gate: 'tests_pass',
        requiredOutput: 'Code và test',
      },
      sensitiveActionsNeedApproval: true,
      canEditWorkspace: true,
    });

    expect(prompt).toContain('bước 3/6 "Phát triển"');
    expect(prompt).toContain('Đầu ra bắt buộc của bước: Code và test');
    expect(prompt).toContain('lệnh kiểm thử');
    expect(prompt).toContain('Chia task (PM Linh): Chia 3 việc');
    expect(prompt).toContain('TC-03 còn lỗi');
    expect(prompt).toContain('.aiteam-qa/login.md');
    expect(prompt).toContain('needs_approval');
    expect(prompt).toContain('<aiteam-report>');
  });

  // Regression (real run): a reviewer copied the example outcome "done" while meaning "pass".
  it('shows "pass" as the example outcome when a verdict is expected', () => {
    const qcPrompt = buildStepPrompt({
      ...base,
      step: { name: 'Kiểm thử', number: 4, count: 6, gate: 'qc_pass', requiredOutput: '' },
      sensitiveActionsNeedApproval: true,
      canEditWorkspace: false,
    });
    const reviewPrompt = buildReviewPrompt({
      taskCode: 'T-1',
      title: 'x',
      goal: base.goal,
      stepName: 'Review',
      requiredOutput: '',
      workerName: 'PM',
      workerSummary: 'xong',
      reviewerRoleLabel: 'Manager',
    });

    expect(qcPrompt).toContain('{"outcome": "pass"');
    expect(reviewPrompt).toContain('{"outcome": "pass"');
    expect(reviewPrompt).not.toContain('{"outcome": "done"');
  });

  it('offers splitting only with subordinates, naming them, and says so on a subtask', () => {
    const lead = buildStepPrompt({
      ...base,
      step: null,
      sensitiveActionsNeedApproval: true,
      canEditWorkspace: true,
      splitCandidates: [{ name: 'Dev backend', roleLabel: 'Dev' }],
    });
    const worker = buildStepPrompt({
      ...base,
      step: null,
      sensitiveActionsNeedApproval: true,
      canEditWorkspace: true,
      subtaskOf: { taskCode: 'T-3', title: 'Trang đăng nhập' },
    });

    expect(lead).toContain('"subtasks"');
    expect(lead).toContain('Cấp dưới của bạn: Dev backend (Dev).');
    expect(worker).not.toContain('"subtasks"');
    expect(worker).toContain('task con do cấp trên tách ra từ task T-3 "Trang đăng nhập"');
  });

  it('lists skills to read, or gives their text to agents that cannot open files', () => {
    const listed = buildStepPrompt({
      ...base,
      step: null,
      sensitiveActionsNeedApproval: true,
      canEditWorkspace: true,
      skills: [
        {
          name: 'Viết test',
          description: 'Khi viết code',
          manifestPath: '.aiteam-skills/viet-test/SKILL.md',
          content: null,
        },
      ],
    });
    const inline = buildStepPrompt({
      ...base,
      step: null,
      sensitiveActionsNeedApproval: true,
      canEditWorkspace: false,
      skills: [{ name: 'Viết test', description: '', manifestPath: null, content: 'Test trước.' }],
    });

    expect(listed).toContain(
      '- Viết test: Khi viết code (hướng dẫn: .aiteam-skills/viet-test/SKILL.md)',
    );
    expect(inline).toContain('### Skill "Viết test"');
    expect(inline).toContain('Test trước.');
  });

  it('tells read-only agents not to change files, and leaves out the approval rule when off', () => {
    const prompt = buildStepPrompt({
      ...base,
      step: null,
      sensitiveActionsNeedApproval: false,
      canEditWorkspace: false,
    });

    expect(prompt).toContain('chỉ có quyền đọc');
    expect(prompt).not.toContain('KHÔNG làm');
    expect(prompt).toContain('tự thực hiện toàn bộ task');
  });
});
