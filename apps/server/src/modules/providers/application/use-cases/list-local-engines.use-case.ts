import { Inject, Injectable } from '@nestjs/common';
import { LOCAL_ENGINES, type LocalEngineStatus } from '@aiteam/contracts';
import {
  AGENT_DIRECTORY_QUERY,
  type AgentDirectoryQuery,
} from '../../../agents/application/ports/agent-directory.query';
import {
  LOCAL_ENGINE_SETTINGS_REPOSITORY,
  type LocalEngineSettingsRepository,
} from '../../domain/repositories/local-engine-settings.repository';
import { LOCAL_ENGINE_PROBE, type LocalEngineProbe } from '../ports/local-engine-probe.port';

@Injectable()
export class ListLocalEnginesUseCase {
  constructor(
    @Inject(LOCAL_ENGINE_PROBE) private readonly localEngineProbe: LocalEngineProbe,
    @Inject(LOCAL_ENGINE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: LocalEngineSettingsRepository,
    @Inject(AGENT_DIRECTORY_QUERY) private readonly agentDirectory: AgentDirectoryQuery,
  ) {}

  async listLocalEngines(): Promise<LocalEngineStatus[]> {
    const agents = this.agentDirectory.listAgentSummaries({});
    return Promise.all(
      LOCAL_ENGINES.map(async (engine) => ({
        engine,
        ...(await this.localEngineProbe.probeLocalEngine(engine)),
        settings: this.settingsRepository.readLocalEngineSettings(engine),
        agentNames: agents.filter((agent) => agent.provider === engine).map((agent) => agent.name),
      })),
    );
  }
}
