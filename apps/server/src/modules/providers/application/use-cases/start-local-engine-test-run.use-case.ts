import { Inject, Injectable } from '@nestjs/common';
import type { LocalEngine } from '@aiteam/contracts';
import {
  AGENT_ENGINE_RESOLVER,
  type AgentEngineResolver,
} from '../../../orchestration/application/ports/agent-engine.port';
import {
  LOCAL_ENGINE_SETTINGS_REPOSITORY,
  type LocalEngineSettingsRepository,
} from '../../domain/repositories/local-engine-settings.repository';
import { resolveSessionPermissions } from '../../domain/session-permissions';
import { EngineTestRunRegistry } from '../engine-test-run-registry';
import {
  SAMPLE_WORKSPACE_FACTORY,
  type SampleWorkspaceFactory,
} from '../ports/sample-workspace.port';

export const LOCAL_ENGINE_TEST_PROMPT =
  'Đọc file README.md trong thư mục hiện tại rồi tóm tắt nội dung trong một câu tiếng Việt. Không sửa hay tạo file nào.';

/** "Chạy thử": a real, read-only, offline run in a throw-away directory with a sample README. */
@Injectable()
export class StartLocalEngineTestRunUseCase {
  constructor(
    @Inject(AGENT_ENGINE_RESOLVER) private readonly engineResolver: AgentEngineResolver,
    @Inject(LOCAL_ENGINE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: LocalEngineSettingsRepository,
    @Inject(SAMPLE_WORKSPACE_FACTORY) private readonly workspaceFactory: SampleWorkspaceFactory,
    private readonly testRunRegistry: EngineTestRunRegistry,
  ) {}

  startLocalEngineTestRun(engine: LocalEngine): { testRunId: string } {
    const settings = this.settingsRepository.readLocalEngineSettings(engine);
    const engineAdapter = this.engineResolver.resolveAgentEngine(engine);
    const workspace = this.workspaceFactory.createSampleWorkspace();
    try {
      const testRunId = this.testRunRegistry.startEngineTestRun(
        `local:${engine}`,
        (signal) =>
          engineAdapter.startSession(
            {
              prompt: LOCAL_ENGINE_TEST_PROMPT,
              workingDirectory: workspace.directory,
              workspaceRoot: null,
              model: settings.defaultModel,
              permissions: resolveSessionPermissions(
                { accessLevel: 'read_only', networkAccess: false },
                settings,
              ),
              resumeSessionRef: null,
              apiConnection: null,
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
