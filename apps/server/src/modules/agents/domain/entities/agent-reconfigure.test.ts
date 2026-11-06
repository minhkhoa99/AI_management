import { describe, expect, it } from 'vitest';
import { Agent } from './agent';

function createCodexAgent(): Agent {
  return Agent.createNew({
    id: 'a1',
    name: 'Dev backend',
    role: 'dev',
    provider: 'codex',
    model: 'gpt-x',
  });
}

describe('Agent.reconfigure', () => {
  it('returns null and changes nothing when the patch matches the current configuration', () => {
    const agent = createCodexAgent();

    expect(agent.reconfigure({ provider: 'codex', accessLevel: 'read_only' })).toBeNull();
  });

  it('publishes the changes and keeps the model when only permissions change', () => {
    const agent = createCodexAgent();

    const event = agent.reconfigure({ accessLevel: 'edit_workspace', networkAccess: true });

    expect(event).toEqual({
      type: 'AgentConfigurationChanged',
      agentId: 'a1',
      changes: [
        { field: 'accessLevel', from: 'read_only', to: 'edit_workspace' },
        { field: 'networkAccess', from: false, to: true },
      ],
      reducesPermissions: false,
    });
    expect(agent.toState().model).toBe('gpt-x');
  });

  it('resets the model when the provider changes without a new model', () => {
    const agent = createCodexAgent();

    agent.reconfigure({ provider: 'claude_code' });

    expect(agent.readEngineConfiguration()).toMatchObject({ provider: 'claude_code', model: null });
  });

  it('switches to Custom API only with a connection, and drops it when leaving', () => {
    const agent = createCodexAgent();

    expect(() => agent.reconfigure({ provider: 'custom_api' })).toThrow(
      expect.objectContaining({ code: 'CONNECTION_REQUIRED' }),
    );
    agent.reconfigure({ provider: 'custom_api', connectionId: 'c1', model: 'llama-3' });
    expect(agent.readEngineConfiguration()).toMatchObject({ connectionId: 'c1', model: 'llama-3' });

    agent.reconfigure({ provider: 'codex' });
    expect(agent.readEngineConfiguration()).toMatchObject({
      provider: 'codex',
      connectionId: null,
      model: null,
    });
  });

  it('resets the model when only the connection changes', () => {
    const agent = createCodexAgent();
    agent.reconfigure({ provider: 'custom_api', connectionId: 'c1', model: 'llama-3' });

    const event = agent.reconfigure({ connectionId: 'c2' });

    expect(event?.changes.map((change) => change.field)).toEqual(['connectionId', 'model']);
  });

  it('refuses a connection for a local engine', () => {
    expect(() => createCodexAgent().reconfigure({ connectionId: 'c1' })).toThrow(
      expect.objectContaining({ code: 'CONNECTION_NOT_APPLICABLE' }),
    );
  });

  it('flags permission reductions, including turning the agent off', () => {
    const agent = createCodexAgent();
    agent.reconfigure({ accessLevel: 'edit_workspace' });

    expect(agent.reconfigure({ accessLevel: 'read_only' })?.reducesPermissions).toBe(true);
    expect(agent.setEnabled(false)?.reducesPermissions).toBe(true);
    expect(agent.setEnabled(false)).toBeNull();
    expect(agent.setEnabled(true)?.reducesPermissions).toBe(false);
  });
});
