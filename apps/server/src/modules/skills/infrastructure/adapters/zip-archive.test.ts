import { describe, expect, it } from 'vitest';
import { buildZipArchive } from '../../../../test-support/zip-builder';
import { listZipFiles, readZipFile } from './zip-archive';

describe('ZIP archive reader', () => {
  it('lists files (not folders) and inflates them', () => {
    const archive = buildZipArchive([
      { path: 'skill/SKILL.md', content: '# Skill\n' },
      { path: 'skill/scripts/run.sh', content: 'echo hi\n' },
    ]);

    const files = listZipFiles(archive);

    expect(files.map((file) => file.path)).toEqual(['skill/SKILL.md', 'skill/scripts/run.sh']);
    expect(readZipFile(archive, files[0]!).toString('utf8')).toBe('# Skill\n');
  });

  it.each([
    ['a parent folder', '../evil.sh'],
    ['an absolute path', '/etc/passwd'],
    ['a drive letter', 'C:/Windows/evil.dll'],
    ['a backslash parent', 'skill\\..\\..\\evil.sh'],
  ])('refuses %s (zip slip)', (_label, path) => {
    const archive = buildZipArchive([{ path, content: 'x' }]);

    expect(() => listZipFiles(archive)).toThrow('không an toàn');
  });

  it('refuses symlinks', () => {
    const archive = buildZipArchive([
      { path: 'skill/link', content: '/etc/passwd', symlink: true },
    ]);

    expect(() => listZipFiles(archive)).toThrow('liên kết');
  });

  it('refuses an entry that inflates beyond its declared size (zip bomb)', () => {
    const archive = buildZipArchive([
      { path: 'bomb.txt', content: Buffer.alloc(1_000_000), declaredSize: 10 },
    ]);
    const [entry] = listZipFiles(archive);

    expect(() => readZipFile(archive, entry!)).toThrow();
  });

  it('refuses something that is not a ZIP', () => {
    expect(() => listZipFiles(Buffer.from('not a zip at all, just text'))).toThrow(
      'không phải file zip',
    );
  });
});
