import { describe, expect, it } from 'vitest';
import {
  type AgentEngineConfiguration,
  describeConfigurationChanges,
  reducesPermissions,
} from './agent-configuration';

const baseline: AgentEngineConfiguration = {
  provider: 'codex',
  connectionId: null,
  model: null,
  accessLevel: 'edit_workspace',
  networkAccess: true,
  enabled: true,
};

function withChanges(changes: Partial<AgentEngineConfiguration>): AgentEngineConfiguration {
  return { ...baseline, ...changes };
}

describe('reducesPermissions', () => {
  it.each<[string, Partial<AgentEngineConfiguration>, Partial<AgentEngineConfiguration>]>([
    ['edit_workspace → read_only', {}, { accessLevel: 'read_only' }],
    ['network on → off', {}, { networkAccess: false }],
    ['agent enabled → disabled', {}, { enabled: false }],
    ['several reductions at once', {}, { accessLevel: 'read_only', networkAccess: false }],
    [
      'a reduction combined with a provider change',
      {},
      { provider: 'claude_code', networkAccess: false },
    ],
    [
      'a reduction combined with an increase elsewhere',
      { networkAccess: false },
      { networkAccess: true, accessLevel: 'read_only' },
    ],
  ])('is true for %s', (_label, beforeChanges, afterChanges) => {
    expect(reducesPermissions(withChanges(beforeChanges), withChanges(afterChanges))).toBe(true);
  });

  it.each<[string, Partial<AgentEngineConfiguration>, Partial<AgentEngineConfiguration>]>([
    ['no change', {}, {}],
    ['read_only → edit_workspace', { accessLevel: 'read_only' }, { accessLevel: 'edit_workspace' }],
    ['network off → on', { networkAccess: false }, { networkAccess: true }],
    ['agent disabled → enabled', { enabled: false }, { enabled: true }],
    ['provider change only', {}, { provider: 'claude_code' }],
    ['model change only', { model: 'gpt-a' }, { model: 'gpt-b' }],
    [
      'connection change only',
      { provider: 'custom_api', connectionId: 'c1' },
      { provider: 'custom_api', connectionId: 'c2' },
    ],
    [
      'already read-only and offline stays so',
      { accessLevel: 'read_only', networkAccess: false },
      { accessLevel: 'read_only', networkAccess: false, model: 'x' },
    ],
    ['disabled agent stays disabled', { enabled: false }, { enabled: false, model: 'x' }],
  ])('is false for %s', (_label, beforeChanges, afterChanges) => {
    expect(reducesPermissions(withChanges(beforeChanges), withChanges(afterChanges))).toBe(false);
  });

  it('counts a lost permission even while the agent is disabled (applies when re-enabled)', () => {
    expect(
      reducesPermissions(
        withChanges({ enabled: false }),
        withChanges({ enabled: false, networkAccess: false }),
      ),
    ).toBe(true);
  });
});

describe('describeConfigurationChanges', () => {
  it('lists every changed field with old and new values, in a stable order', () => {
    const changes = describeConfigurationChanges(
      baseline,
      withChanges({ model: 'o-mini', provider: 'claude_code', enabled: false }),
    );

    expect(changes).toEqual([
      { field: 'provider', from: 'codex', to: 'claude_code' },
      { field: 'model', from: null, to: 'o-mini' },
      { field: 'enabled', from: true, to: false },
    ]);
  });

  it('is empty when nothing changed', () => {
    expect(describeConfigurationChanges(baseline, { ...baseline })).toEqual([]);
  });
});
