import { describe, expect, it } from 'vitest';
import {
  buildCompletionGoal,
  countQaTestCases,
  qaDocumentNameSchema,
  resolveTaskBoardColumn,
} from './tasks';

describe('countQaTestCases', () => {
  it('counts Gherkin scenarios, including Vietnamese keywords and outlines', () => {
    const feature = [
      'Feature: Thanh toán',
      '  Scenario: Thẻ hợp lệ',
      '  Scenario Outline: Thẻ hết hạn <năm>',
      '  Kịch bản: Huỷ đơn',
      '  # Scenario: commented',
    ].join('\n');

    expect(countQaTestCases(feature, 'checkout.feature')).toBe(3);
  });

  it('counts CSV rows without the header and ignores blank lines', () => {
    expect(countQaTestCases('id,case\r\n1,a\r\n2,b\r\n\r\n', 'cases.CSV')).toBe(2);
  });

  it('counts checklists, TC ids and test headings in Markdown or text', () => {
    const markdown = [
      '# Đăng nhập',
      '- [ ] Đúng mật khẩu',
      '- [x] Sai mật khẩu',
      'TC-03 Email trống',
      '## Test khoá tài khoản',
      'Ghi chú thường',
    ].join('\n');

    expect(countQaTestCases(markdown, 'login.md')).toBe(4);
  });
});

describe('buildCompletionGoal', () => {
  it('uses the QA documents when there are any', () => {
    const goal = buildCompletionGoal({
      description: 'API đăng nhập',
      criteria: 'Sai mật khẩu trả 401',
      qaDocuments: [
        { fileName: 'login.md', detectedCases: 14 },
        { fileName: 'edge.xlsx', detectedCases: null },
      ],
    });

    expect(goal).toMatchObject({
      source: 'qa',
      summary: 'đọc 2 tài liệu QA (14 kịch bản) làm đích',
      items: ['login.md – 14 kịch bản', 'edge.xlsx'],
    });
  });

  it('falls back to criteria, then to the description, then reports no goal', () => {
    expect(
      buildCompletionGoal({ description: 'x', criteria: ' A \n\n B ', qaDocuments: [] }),
    ).toMatchObject({ source: 'description', items: ['A', 'B'] });
    expect(
      buildCompletionGoal({ description: ' Làm form ', criteria: '', qaDocuments: [] }),
    ).toMatchObject({ source: 'description', items: ['Làm form'] });
    expect(buildCompletionGoal({ description: '', criteria: '', qaDocuments: [] }).source).toBe(
      'none',
    );
  });
});

describe('task board and QA names', () => {
  it('puts tasks in kanban columns from their status and current gate', () => {
    expect(resolveTaskBoardColumn('queued', null)).toBe('todo');
    expect(resolveTaskBoardColumn('running', 'tests_pass')).toBe('in_progress');
    expect(resolveTaskBoardColumn('running', 'qc_pass')).toBe('qc');
    expect(resolveTaskBoardColumn('waiting_approval', null)).toBe('in_progress');
    expect(resolveTaskBoardColumn('succeeded', 'qc_pass')).toBe('done');
  });

  it.each(['../secret.md', 'a/b.md', 'a\\b.md', 'C:\\x.md', 'run.exe', 'notes', 'tab\t.md'])(
    'rejects the QA file name %s',
    (fileName) => {
      expect(qaDocumentNameSchema.safeParse(fileName).success).toBe(false);
    },
  );

  it('accepts ordinary QA file names', () => {
    expect(qaDocumentNameSchema.safeParse('Kịch bản đăng nhập v2.feature').success).toBe(true);
  });
});
