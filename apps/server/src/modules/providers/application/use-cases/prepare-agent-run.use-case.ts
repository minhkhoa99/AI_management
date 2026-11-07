import { Inject, Injectable } from '@nestjs/common';
import { ValidationError } from '../../../../shared/errors/app-error';
import type { EngineSnapshot } from '../../../orchestration/domain/entities/task';
import {
  AGENT_ENGINE_RESOLVER,
  type AgentEngineResolver,
} from '../../../orchestration/application/ports/agent-engine.port';
import type {
  AgentRunPreparer,
  PreparedAgentRun,
} from '../../../orchestration/application/ports/task-execution.ports';
import {
  LOCAL_ENGINE_SETTINGS_REPOSITORY,
  type LocalEngineSettingsRepository,
} from '../../domain/repositories/local-engine-settings.repository';
import {
  PROVIDER_CONNECTION_REPOSITORY,
  type ProviderConnectionRepository,
} from '../../domain/repositories/provider-connection.repository';
import { resolveSessionPermissions } from '../../domain/session-permissions';
import { SECRET_VAULT, type SecretVault } from '../ports/secret-vault.port';
import { readConnectionApiKey, requireProviderConnection } from './provider-connection-lookup';

/**
 * What one agent session needs: the engine, the model (the agent's, else the engine's or the
 * connection's default), the permissions capped by the engine settings, and, for Custom API,
 * the decrypted key (kept in memory only for this session).
 */
@Injectable()
export class PrepareAgentRunUseCase implements AgentRunPreparer {
  constructor(
    @Inject(AGENT_ENGINE_RESOLVER) private readonly engineResolver: AgentEngineResolver,
    @Inject(LOCAL_ENGINE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: LocalEngineSettingsRepository,
    @Inject(PROVIDER_CONNECTION_REPOSITORY)
    private readonly connectionRepository: ProviderConnectionRepository,
    @Inject(SECRET_VAULT) private readonly secretVault: SecretVault,
  ) {}

  prepareAgentRun(snapshot: EngineSnapshot): PreparedAgentRun {
    const engine = this.engineResolver.resolveAgentEngine(snapshot.provider);
    const agentFlags = { accessLevel: snapshot.accessLevel, networkAccess: snapshot.networkAccess };
    if (snapshot.provider === 'custom_api') {
      if (snapshot.connectionId === null) {
        throw new ValidationError('Agent dùng Custom API nhưng chưa chọn kết nối.', {
          code: 'AGENT_CONNECTION_MISSING',
        });
      }
      const connection = requireProviderConnection(
        this.connectionRepository,
        snapshot.connectionId,
      );
      const state = connection.toState();
      return {
        engine,
        model: snapshot.model ?? state.defaultModel,
        permissions: resolveSessionPermissions(agentFlags, null),
        apiConnection: {
          format: state.format,
          baseUrl: state.baseUrl,
          apiKey: readConnectionApiKey(this.secretVault, connection),
        },
      };
    }
    const settings = this.settingsRepository.readLocalEngineSettings(snapshot.provider);
    return {
      engine,
      model: snapshot.model ?? settings.defaultModel,
      permissions: resolveSessionPermissions(agentFlags, settings),
      apiConnection: null,
    };
  }
}
