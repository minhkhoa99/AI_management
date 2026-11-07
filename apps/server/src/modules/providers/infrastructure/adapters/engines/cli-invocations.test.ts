import { describe, expect, it, vi } from 'vitest';

// CI machines have neither CLI installed: only the arguments are under test.
vi.mock('./cli-process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cli-process')>()),
  resolveCliExecutable: (executableName: string) => ({ command: executableName, leadingArgs: [] }),
}));
import type {
  AgentSessionRequest,
  SessionPermissions,
} from '../../../../orchestration/application/ports/agent-engine.port';
import { buildClaudeInvocation } from './claude-code-cli.engine';
import { buildCodexInvocation } from './codex-cli.engine';

function request(
  permissions: Partial<SessionPermissions>,
  resumeSessionRef: string | null = null,
): AgentSessionRequest {
  return {
    prompt: 'làm việc',
    workingDirectory: '/work',
    model: null,
    permissions: {
      accessLevel: 'read_only',
      networkAccess: false,
      blockDangerousCommands: true,
      ...permissions,
    },
    resumeSessionRef,
    apiConnection: null,
  };
}

function valuesAfter(args: string[], flag: string): string[] {
  const start = args.indexOf(flag);
  if (start === -1) return [];
  const values: string[] = [];
  for (const value of args.slice(start + 1)) {
    if (value.startsWith('--')) break;
    values.push(value);
  }
  return values;
}

describe('Claude Code invocation', () => {
  it('lets an editing agent run commands in the workspace, dangerous ones still denied', () => {
    const { args } = buildClaudeInvocation(request({ accessLevel: 'edit_workspace' }));

    expect(valuesAfter(args, '--permission-mode')).toEqual(['acceptEdits']);
    expect(valuesAfter(args, '--allowedTools')).toEqual(['Bash', 'PowerShell']);
    expect(valuesAfter(args, '--disallowedTools')).toEqual(
      expect.arrayContaining(['Bash(rm -rf:*)', 'Bash(git push:*)', 'Bash(curl:*)', 'WebFetch']),
    );
  });

  it('gives a read-only agent no editing or shell tool', () => {
    const { args } = buildClaudeInvocation(request({}));

    expect(args).not.toContain('--allowedTools');
    expect(valuesAfter(args, '--disallowedTools')).toEqual(
      expect.arrayContaining(['Write', 'Edit', 'Bash', 'PowerShell']),
    );
  });

  it('loads no settings file, so hooks or apiKeyHelper written into the worktree never run', () => {
    const { args } = buildClaudeInvocation(request({ accessLevel: 'edit_workspace' }));

    expect(valuesAfter(args, '--setting-sources')).toEqual(['']);
    expect(JSON.parse(valuesAfter(args, '--settings')[0] ?? '{}')).toEqual({
      disableAllHooks: true,
    });
  });

  it('leaves out --disallowedTools when nothing is denied (a bare flag fails the run)', () => {
    const { args } = buildClaudeInvocation(
      request({
        accessLevel: 'edit_workspace',
        networkAccess: true,
        blockDangerousCommands: false,
      }),
    );

    expect(args).not.toContain('--disallowedTools');
  });

  it('puts the project instructions before the task prompt', () => {
    const { stdinText } = buildClaudeInvocation(request({}), 'Dùng tab.');

    expect(stdinText).toContain('Dùng tab.');
    expect(stdinText.indexOf('Dùng tab.')).toBeLessThan(stdinText.indexOf('làm việc'));
    expect(stdinText.endsWith('làm việc')).toBe(true);
    expect(buildClaudeInvocation(request({})).stdinText).toBe('làm việc');
  });

  it.each([
    ['Claude', buildClaudeInvocation],
    ['Codex', buildCodexInvocation],
  ])('%s refuses a session id that could be read as an option', (_label, buildInvocation) => {
    expect(() => buildInvocation(request({}, '--dangerously-skip-permissions'))).toThrow(
      'Mã phiên',
    );
    expect(() =>
      buildInvocation(request({}, '019a3f2e-77aa-7c1d-9a5b-1d2e3f4a5b6c')),
    ).not.toThrow();
  });

  it('resumes the earlier session when asked', () => {
    expect(valuesAfter(buildClaudeInvocation(request({}, 'abc')).args, '--resume')).toEqual([
      'abc',
    ]);
  });
});

describe('Codex invocation', () => {
  it('maps permissions onto the sandbox', () => {
    const editing = buildCodexInvocation(
      request({ accessLevel: 'edit_workspace', networkAccess: true }),
    ).args;
    const reading = buildCodexInvocation(request({})).args;

    expect(editing).toEqual(
      expect.arrayContaining([
        '-s',
        'workspace-write',
        'sandbox_workspace_write.network_access=true',
      ]),
    );
    expect(reading).toEqual(expect.arrayContaining(['-s', 'read-only']));
  });
});
