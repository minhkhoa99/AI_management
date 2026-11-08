import { describe, expect, it } from 'vitest';
import { selectSkillFiles } from './skill-bundle';
import { buildSkillManifest, parseSkillManifest, toSkillSlug } from './skill-manifest';

const limits = { maxFiles: 10, maxTotalBytes: 1_000 };
const file = (path: string, size = 10) => ({ path, size });

describe('SKILL.md manifest', () => {
  it('reads name and description from the front matter, quoted or folded', () => {
    const manifest = parseSkillManifest(
      [
        '---',
        'name: "pdf: tools"',
        'description: >',
        '  Đọc và tạo',
        '  file PDF',
        'license: MIT',
        '---',
        '',
        '# PDF',
      ].join('\n'),
    );

    expect(manifest).toEqual({
      name: 'pdf: tools',
      description: 'Đọc và tạo file PDF',
      body: '# PDF',
    });
  });

  it('treats a file without front matter as the body', () => {
    expect(parseSkillManifest('# Chỉ nội dung\n')).toEqual({
      name: null,
      description: null,
      body: '# Chỉ nội dung',
    });
  });

  it('writes a front matter that reads back the same, whatever the characters', () => {
    const written = buildSkillManifest({ name: 'A: "b"', description: 'x\ny', body: 'Nội dung' });

    expect(parseSkillManifest(written)).toEqual({
      name: 'A: "b"',
      description: 'x\ny',
      body: 'Nội dung',
    });
  });

  it('makes ASCII folder names', () => {
    expect(toSkillSlug('Viết kịch bản kiểm thử (QA)')).toBe('viet-kich-ban-kiem-thu-qa');
    expect(toSkillSlug('Đặt tên')).toBe('dat-ten');
    expect(toSkillSlug('!!!')).toBe('skill');
  });
});

describe('selectSkillFiles', () => {
  it('takes the folder of SKILL.md from a GitHub archive and a chosen folder', () => {
    const selected = selectSkillFiles(
      [
        file('skills-main/README.md'),
        file('skills-main/pdf/SKILL.md'),
        file('skills-main/pdf/scripts/fill.py'),
        file('skills-main/docx/SKILL.md'),
      ],
      { folder: 'pdf', stripTopFolder: true },
      limits,
    );

    expect(selected).toEqual([
      { sourcePath: 'skills-main/pdf/SKILL.md', targetPath: 'SKILL.md' },
      { sourcePath: 'skills-main/pdf/scripts/fill.py', targetPath: 'scripts/fill.py' },
    ]);
  });

  it('refuses an archive with several skills at the same depth', () => {
    expect(() =>
      selectSkillFiles(
        [file('a/SKILL.md'), file('b/SKILL.md')],
        { folder: null, stripTopFolder: false },
        limits,
      ),
    ).toThrow('nhiều skill');
  });

  it('uses a lone Markdown file as SKILL.md, and fails without any', () => {
    expect(
      selectSkillFiles(
        [file('guide.md'), file('notes.txt')],
        { folder: null, stripTopFolder: false },
        limits,
      ),
    ).toEqual([{ sourcePath: 'guide.md', targetPath: 'SKILL.md' }]);
    expect(() =>
      selectSkillFiles([file('a.txt')], { folder: null, stripTopFolder: false }, limits),
    ).toThrow('SKILL.md');
  });

  it('enforces the file count and size limits', () => {
    expect(() =>
      selectSkillFiles(
        [file('SKILL.md', 600), file('big.bin', 600)],
        { folder: null, stripTopFolder: false },
        limits,
      ),
    ).toThrow('quá lớn');
  });
});
