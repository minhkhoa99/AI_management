import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsDirectoryInspector } from './fs-directory-inspector';

describe('FsDirectoryInspector', () => {
  let root: string;
  const inspector = new FsDirectoryInspector();

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-dirs-')));
    mkdirSync(path.join(root, 'project', 'src'), { recursive: true });
    mkdirSync(path.join(root, 'project', '.git'));
    mkdirSync(path.join(root, 'outside'));
    writeFileSync(path.join(root, 'project', 'README.md'), '# x');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves "..", detects git work trees from a parent and reports files and missing paths', async () => {
    const nested = await inspector.inspectDirectory(path.join(root, 'project', 'src', '..', 'src'));
    const file = await inspector.inspectDirectory(path.join(root, 'project', 'README.md'));
    const missing = await inspector.inspectDirectory(path.join(root, 'nope'));

    expect(nested).toEqual({
      absolutePath: path.join(root, 'project', 'src'),
      exists: true,
      isDirectory: true,
      isGitRepository: true,
    });
    expect(file).toMatchObject({ exists: true, isDirectory: false });
    expect(missing).toMatchObject({ exists: false, isGitRepository: false });
  });

  it('follows symlinks to their real location, so a link cannot escape an allowed folder', async () => {
    const link = path.join(root, 'project', 'escape');
    try {
      symlinkSync(path.join(root, 'outside'), link, 'junction');
    } catch {
      return; // Creating links needs extra rights on some Windows setups.
    }

    const facts = await inspector.inspectDirectory(link);

    expect(facts.absolutePath).toBe(path.join(root, 'outside'));
    expect(inspector.isInsideDirectory(facts.absolutePath, path.join(root, 'project'))).toBe(false);
  });

  it('compares folders by path segments, not by text prefix', () => {
    const allowed = path.join(root, 'project');

    expect(inspector.isInsideDirectory(allowed, allowed)).toBe(true);
    expect(inspector.isInsideDirectory(path.join(allowed, 'src'), allowed)).toBe(true);
    expect(inspector.isInsideDirectory(`${allowed}-other`, allowed)).toBe(false);
    expect(inspector.isInsideDirectory(path.join(allowed, '..', 'outside'), allowed)).toBe(false);
    // A child folder whose name merely starts with ".." is still inside.
    expect(inspector.isInsideDirectory(path.join(allowed, '..project'), allowed)).toBe(true);
  });
});
