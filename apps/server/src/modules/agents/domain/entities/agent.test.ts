import { describe, expect, it } from 'vitest';
import { Agent } from './agent';

describe('Agent', () => {
  it('starts enabled with the least privileges', () => {
    const agent = Agent.createNew({
      id: 'a1',
      name: ' Dev backend ',
      role: 'dev',
      provider: 'codex',
    });

    expect(agent.toState()).toEqual({
      id: 'a1',
      name: 'Dev backend',
      role: 'dev',
      provider: 'codex',
      connectionId: null,
      model: null,
      accessLevel: 'read_only',
      networkAccess: false,
      enabled: true,
    });
  });

  it('requires a connection for Custom API and forbids one for local engines', () => {
    expect(() =>
      Agent.createNew({ id: 'a1', name: 'X', role: 'qc', provider: 'custom_api' }),
    ).toThrow(expect.objectContaining({ code: 'CONNECTION_REQUIRED' }));
    expect(() =>
      Agent.createNew({
        id: 'a1',
        name: 'X',
        role: 'qc',
        provider: 'claude_code',
        connectionId: 'c1',
      }),
    ).toThrow(expect.objectContaining({ code: 'CONNECTION_NOT_APPLICABLE' }));
    expect(
      Agent.createNew({
        id: 'a1',
        name: 'X',
        role: 'qc',
        provider: 'custom_api',
        connectionId: 'c1',
      }).toState().connectionId,
    ).toBe('c1');
  });

  it('validates names on rename', () => {
    const agent = Agent.createNew({ id: 'a1', name: 'PM', role: 'pm', provider: 'codex' });

    expect(() => agent.rename('   ')).toThrow(
      expect.objectContaining({ code: 'AGENT_NAME_INVALID' }),
    );
    agent.rename('Product manager');
    expect(agent.toState().name).toBe('Product manager');
  });
});
