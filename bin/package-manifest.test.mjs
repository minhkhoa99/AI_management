// The published package (`npm i -g @minhkhoa/aimanagement`, command `aimanagement`) must run from its bundle alone.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

describe('published package manifest', () => {
  it('installs the aimanagement command from the launcher', () => {
    expect(manifest.name).toBe('@minhkhoa/aimanagement');
    expect(manifest.publishConfig).toEqual({ access: 'public' });
    expect(manifest.bin).toEqual({ aimanagement: 'bin/aiteam.mjs' });
    expect(existsSync(path.join(packageRoot, manifest.bin.aimanagement))).toBe(true);
    expect(manifest.private).toBeUndefined();
    expect(manifest.license).toBe('MIT');
  });

  it('has no runtime dependencies and ships only the launcher and the build', () => {
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.scripts.install).toBeUndefined();
    expect(manifest.scripts.postinstall).toBeUndefined();
    expect(manifest.files).toEqual(['bin/aiteam.mjs', 'bin/node-version-policy.mjs', 'dist/']);
  });

  it('builds and checks the bundle before packing', () => {
    expect(manifest.scripts.prepack).toContain('npm run build');
    expect(manifest.scripts.prepack).toContain('npm run test:smoke');
  });
});
