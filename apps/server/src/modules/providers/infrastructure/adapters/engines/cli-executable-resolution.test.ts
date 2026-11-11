import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../../../shared/errors/app-error';
import { resolveCliExecutable } from './cli-process';

const NODE = '/fake/node';
let root: string;

function makeDirectory(name: string): string {
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function writeNpmShim(directory: string): void {
  const script = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(script, '');
  writeFileSync(
    path.join(directory, 'codex.cmd'),
    '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
  );
}

function windows(...directories: string[]) {
  return { platform: 'win32' as const, pathValue: directories.join(';'), nodeExecutablePath: NODE };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'aiteam-cli-path-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveCliExecutable', () => {
  // Regression: an older codex.exe later on PATH used to win over the npm shim the terminal runs.
  // The shim's script path is written with backslashes: only resolvable on Windows.
  it.runIf(process.platform === 'win32')(
    'on Windows takes the first PATH directory holding the CLI, even when it is an npm shim',
    () => {
      const npmDirectory = makeDirectory('nodejs');
      writeNpmShim(npmDirectory);
      const otherDirectory = makeDirectory('other-tool-bin');
      writeFileSync(path.join(otherDirectory, 'codex.exe'), '');

      expect(resolveCliExecutable('codex', windows(npmDirectory, otherDirectory))).toEqual({
        command: NODE,
        leadingArgs: [path.join(npmDirectory, 'node_modules\\@openai\\codex\\bin\\codex.js')],
      });
    },
  );

  it('on Windows prefers the native .exe over the shim inside one directory', () => {
    const directory = makeDirectory('both');
    writeNpmShim(directory);
    writeFileSync(path.join(directory, 'codex.exe'), '');
    expect(resolveCliExecutable('codex', windows(directory))).toEqual({
      command: path.join(directory, 'codex.exe'),
      leadingArgs: [],
    });
  });

  it('on Windows skips a .cmd that is not an npm shim and keeps looking', () => {
    const plainCmd = makeDirectory('plain');
    writeFileSync(path.join(plainCmd, 'codex.cmd'), '@echo hello\r\n');
    const later = makeDirectory('later');
    writeFileSync(path.join(later, 'codex.exe'), '');
    expect(resolveCliExecutable('codex', windows(plainCmd, later)).command).toBe(
      path.join(later, 'codex.exe'),
    );
  });

  // POSIX PATH uses ':' which Windows drive letters contain.
  it.skipIf(process.platform === 'win32')(
    'elsewhere takes the first PATH directory holding the command',
    () => {
      const first = makeDirectory('first');
      const second = makeDirectory('second');
      writeFileSync(path.join(first, 'codex'), '');
      writeFileSync(path.join(second, 'codex'), '');
      const environment = {
        platform: 'linux' as const,
        pathValue: `${first}:${second}`,
        nodeExecutablePath: NODE,
      };
      expect(resolveCliExecutable('codex', environment).command).toBe(path.join(first, 'codex'));
    },
  );

  it('reports a missing CLI as ENGINE_NOT_INSTALLED', () => {
    const empty = makeDirectory('empty');
    let caught: unknown;
    try {
      resolveCliExecutable('codex', windows(empty));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('ENGINE_NOT_INSTALLED');
  });
});
