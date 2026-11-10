import { Inject, Injectable } from '@nestjs/common';
import { ValidationError } from '../../../../shared/errors/app-error';
import {
  AGENT_ENGINE_RESOLVER,
  type AgentEngineResolver,
} from '../../../orchestration/application/ports/agent-engine.port';
import {
  PROVIDER_CONNECTION_REPOSITORY,
  type ProviderConnectionRepository,
} from '../../domain/repositories/provider-connection.repository';
import { resolveSessionPermissions } from '../../domain/session-permissions';
import { EngineTestRunRegistry } from '../engine-test-run-registry';
import {
  SAMPLE_WORKSPACE_FACTORY,
  type SampleWorkspaceFactory,
} from '../ports/sample-workspace.port';
import { SECRET_VAULT, type SecretVault } from '../ports/secret-vault.port';
import { readConnectionApiKey, requireProviderConnection } from './provider-connection-lookup';

export const CONNECTION_TEST_PROMPT =
  'Trả lời bằng đúng một câu tiếng Việt: xác nhận bạn đang hoạt động bình thường.';

/** Sends one short real prompt through a Custom API connection and streams the answer. */
@Injectable()
export class StartConnectionTestRunUseCase {
  constructor(
    @Inject(PROVIDER_CONNECTION_REPOSITORY)
    private readonly connectionRepository: ProviderConnectionRepository,
    @Inject(SECRET_VAULT) private readonly secretVault: SecretVault,
    @Inject(AGENT_ENGINE_RESOLVER) private readonly engineResolver: AgentEngineResolver,
    @Inject(SAMPLE_WORKSPACE_FACTORY) private readonly workspaceFactory: SampleWorkspaceFactory,
    private readonly testRunRegistry: EngineTestRunRegistry,
  ) {}

  startConnectionTestRun(connectionId: string, model: string): { testRunId: string } {
    const connection = requireProviderConnection(this.connectionRepository, connectionId);
    const state = connection.toState();
    if (!state.models.includes(model)) {
      throw new ValidationError('Chọn một model đã lưu trong kết nối này.', {
        code: 'MODEL_NOT_LISTED',
      });
    }
    const apiKey = readConnectionApiKey(this.secretVault, connection);
    const engine = this.engineResolver.resolveAgentEngine('custom_api');
    const workspace = this.workspaceFactory.createSampleWorkspace();
    try {
      const testRunId = this.testRunRegistry.startEngineTestRun(
        `connection:${connectionId}`,
        (signal) =>
          engine.startSession(
            {
              prompt: CONNECTION_TEST_PROMPT,
              workingDirectory: workspace.directory,
              workspaceRoot: null,
              model,
              permissions: resolveSessionPermissions(
                { accessLevel: 'read_only', networkAccess: false },
                null,
              ),
              resumeSessionRef: null,
              apiConnection: { format: state.format, baseUrl: state.baseUrl, apiKey },
            },
            signal,
          ),
        () => workspace.disposeSampleWorkspace(),
      );
      return { testRunId };
    } catch (error) {
      workspace.disposeSampleWorkspace();
      throw error;
    }
  }
}
