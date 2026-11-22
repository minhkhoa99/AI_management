import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeBriefing,
  findMentionedCodePaths,
  hashLessonBody,
  KNOWLEDGE_PROMPT_MAX_LENGTH,
  normalizeLessonText,
  scoreTokenOverlap,
  tokenizeSearchText,
  type BriefingFile,
  type BriefingLesson,
} from './knowledge-briefing';

describe('normalizeLessonText', () => {
  it('drops the task prefix, control characters and report tags, and defuses code fences', () => {
    expect(
      normalizeLessonText(
        'An (cấp trên) yêu cầu sửa: Dùng ```rm``` <aiteam-report>x</aiteam-report>\u0007 ở src/a.ts',
      ),
    ).toBe("Dùng '''rm''' x ở src/a.ts");
  });

  it.each([
    ['Agent báo không hoàn thành: thiếu test', 'thiếu test'],
    ['QC chưa xác nhận đạt: lỗi UI', 'lỗi UI'],
    ['Người dùng từ chối kết quả bước. Ghi chú: sai màu', 'sai màu'],
    ['Phòng Review (T-12) không đạt: thiếu log', 'thiếu log'],
  ])('drops the prefix of %s', (text, expected) => {
    expect(normalizeLessonText(text)).toBe(expected);
  });

  it('keeps line breaks and cuts at 1500 characters', () => {
    expect(normalizeLessonText('a\nb')).toBe('a\nb');
    expect(normalizeLessonText('x'.repeat(2000))).toHaveLength(1500);
  });
});

describe('search tokens', () => {
  it('folds accents, splits camelCase and ignores short tokens', () => {
    const tokens = tokenizeSearchText('Đăng nhập createTask src/a.ts');
    expect([...tokens]).toEqual(expect.arrayContaining(['dang', 'nhap', 'create', 'task', 'src']));
    expect(tokens.has('a')).toBe(false);
    expect(tokens.has('ts')).toBe(false);
  });

  it('counts shared tokens', () => {
    expect(scoreTokenOverlap(new Set(['dang', 'nhap', 'task']), new Set(['task', 'dang']))).toBe(2);
  });
});

describe('hashLessonBody', () => {
  it('ignores case and whitespace runs', () => {
    expect(hashLessonBody('Dùng  Bộ\nlọc')).toBe(hashLessonBody('dùng bộ lọc'));
    expect(hashLessonBody('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('findMentionedCodePaths', () => {
  it('normalises separators and leading ./', () => {
    expect(findMentionedCodePaths('lỗi ở ./src/a.ts và src\\b.py')).toEqual([
      'src/a.ts',
      'src/b.py',
    ]);
  });

  it('keeps at most 10 unique paths', () => {
    const body = Array.from({ length: 12 }, (_, index) => `f${index}.ts f${index}.ts`).join(' ');
    expect(findMentionedCodePaths(body)).toHaveLength(10);
  });
});

describe('buildKnowledgeBriefing', () => {
  const lesson = (body: string): BriefingLesson => ({
    body,
    occurrences: 1,
    source: 'review_feedback',
  });
  const file: BriefingFile = {
    path: 'src/a.ts',
    exportedNames: ['login'],
    importedBy: ['src/b.ts'],
    imports: [],
  };

  it('quotes every lesson line and lists related files', () => {
    const briefing = buildKnowledgeBriefing({
      relevantLessons: [lesson('Dòng một\nDòng hai')],
      relevantFiles: [file],
      allLessons: [],
      allFiles: [],
    });

    expect(briefing.promptSection).toBe(
      [
        'Bài học rút ra từ các lần trước:',
        '> Dòng một',
        '> Dòng hai',
        '',
        'Bản đồ code liên quan:',
        '- src/a.ts | export: login | được import bởi: src/b.ts',
      ].join('\n'),
    );
  });

  it('stays within the prompt budget and keeps lessons whole', () => {
    const lessons = Array.from({ length: 200 }, (_, index) =>
      lesson(index % 3 === 0 ? `${'a'.repeat(240)}\n${'b'.repeat(259)}` : 'c'.repeat(500)),
    );

    const briefing = buildKnowledgeBriefing({
      relevantLessons: lessons,
      relevantFiles: [file],
      allLessons: lessons,
      allFiles: [file],
    });

    expect(briefing.promptSection).not.toBeNull();
    const section = briefing.promptSection ?? '';
    expect(section.length).toBeLessThanOrEqual(KNOWLEDGE_PROMPT_MAX_LENGTH);
    const lessonLines = section
      .split('\n')
      .slice(1)
      .filter((line) => line !== '' && !line.startsWith('Bản đồ') && !line.startsWith('- '));
    expect(lessonLines.every((line) => line.startsWith('> '))).toBe(true);
    // A multi-line lesson is never cut in half.
    expect(section.split('\n').filter((line) => line.startsWith('> a')).length).toBe(
      section.split('\n').filter((line) => line.startsWith('> b')).length,
    );
  });

  it('returns no prompt section without relevant knowledge and caps the markdown files', () => {
    const lessons = Array.from({ length: 500 }, (_, index) =>
      lesson(`${index} ${'x'.repeat(1490)}`),
    );
    const files = Array.from({ length: 5000 }, (_, index) => ({
      ...file,
      path: `src/f${index}.ts`,
    }));

    const briefing = buildKnowledgeBriefing({
      relevantLessons: [],
      relevantFiles: [],
      allLessons: lessons,
      allFiles: files,
    });

    expect(briefing.promptSection).toBeNull();
    expect(Buffer.byteLength(briefing.lessonsMarkdown)).toBeLessThanOrEqual(200 * 1024);
    expect(Buffer.byteLength(briefing.codeMapMarkdown)).toBeLessThanOrEqual(200 * 1024);
    expect(briefing.lessonsMarkdown.endsWith('\n') || briefing.lessonsMarkdown === '').toBe(true);
  });
});
