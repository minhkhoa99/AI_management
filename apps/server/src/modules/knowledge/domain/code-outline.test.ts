import { describe, expect, it } from 'vitest';
import { extractCodeOutline, resolveImportPath } from './code-outline';

describe('extractCodeOutline', () => {
  it('reads exports and imports of a TypeScript file', () => {
    const text = [
      "import { b } from './b';",
      "import type { C } from '../lib/c.js';",
      'export async function login() {}',
      'export const TOKEN = 1;',
      'export class Session {}',
      'export interface User {}',
      'export type Id = string;',
      'export enum Role { A }',
      'export { inner as renamed, other };',
      "export * from './re';",
      "const x = require('./legacy');",
      "await import('./lazy');",
      'export default function () {}',
    ].join('\n');

    expect(extractCodeOutline('src/a.ts', text)).toEqual({
      exportedNames: ['Id', 'Role', 'Session', 'TOKEN', 'User', 'login', 'other', 'renamed'],
      importSpecifiers: ['../lib/c.js', './b', './lazy', './legacy', './re'],
    });
  });

  it('reads top-level definitions and imports of a Python file', () => {
    const text =
      'import os\nimport pkg.mod\nfrom .sibling import thing\nfrom app.models import User\ndef top():\n    def inner(): pass\nclass Service:\n    pass';

    expect(extractCodeOutline('app/views.py', text)).toEqual({
      exportedNames: ['Service', 'top'],
      importSpecifiers: ['.sibling', 'app.models', 'os', 'pkg.mod'],
    });
  });

  it('exports the name of a package.json', () => {
    expect(
      extractCodeOutline('packages/contracts/package.json', '{"name":"@aiteam/contracts"}'),
    ).toEqual({ exportedNames: ['@aiteam/contracts'], importSpecifiers: [] });
    expect(extractCodeOutline('package.json', '{ broken')).toEqual({
      exportedNames: [],
      importSpecifiers: [],
    });
  });
});

describe('resolveImportPath', () => {
  const index = {
    paths: new Set([
      'src/b.ts',
      'src/lib/index.ts',
      'src/lib/c.ts',
      'packages/contracts/src/index.ts',
      'app/models.py',
      'app/sibling.py',
    ]),
    packageDirectories: new Map([['@aiteam/contracts', 'packages/contracts']]),
  };

  it.each([
    ['src/a.ts', './b', 'src/b.ts'],
    ['src/a.ts', './lib', 'src/lib/index.ts'],
    ['src/a.ts', './lib/c.js', 'src/lib/c.ts'],
    ['src/a.ts', '@aiteam/contracts', 'packages/contracts/src/index.ts'],
    ['src/a.ts', 'react', null],
    ['src/a.ts', '../../outside', null],
    ['app/views.py', 'app.models', 'app/models.py'],
    ['app/views.py', '.sibling', 'app/sibling.py'],
    ['app/views.py', 'os', null],
    ['app/views.py', '...outside', null],
  ])('resolves %s → %s', (fromPath, specifier, expected) => {
    expect(resolveImportPath(fromPath, specifier, index)).toBe(expected);
  });
});
