import { Module } from '@nestjs/common';
import { AGENT_DIRECTORY_QUERY } from './application/ports/agent-directory.query';
import { PROVIDER_CONNECTION_LOOKUP } from './application/ports/provider-connection-lookup.port';
import { ChangeAgentConfigurationUseCase } from './application/use-cases/change-agent-configuration.use-case';
import { GetAgentDetailUseCase } from './application/use-cases/get-agent-detail.use-case';
import { ListAgentsUseCase } from './application/use-cases/list-agents.use-case';
import { ToggleAgentUseCase } from './application/use-cases/toggle-agent.use-case';
import { ToggleAgentsInBulkUseCase } from './application/use-cases/toggle-agents-in-bulk.use-case';
import { AGENT_REPOSITORY } from './domain/repositories/agent.repository';
import { AgentConfigurationAuditSubscriber } from './infrastructure/adapters/agent-configuration-audit.subscriber';
import { SqliteAgentDirectoryQuery } from './infrastructure/persistence/sqlite-agent-directory.query';
import { SqliteAgentRepository } from './infrastructure/persistence/sqlite-agent.repository';
import { SqliteProviderConnectionLookup } from './infrastructure/persistence/sqlite-provider-connection.lookup';
import { AgentsController } from './presentation/controllers/agents.controller';

/** Agents, their provider choice and on/off state. */
@Module({
  controllers: [AgentsController],
  providers: [
    { provide: AGENT_REPOSITORY, useClass: SqliteAgentRepository },
    { provide: AGENT_DIRECTORY_QUERY, useClass: SqliteAgentDirectoryQuery },
    { provide: PROVIDER_CONNECTION_LOOKUP, useClass: SqliteProviderConnectionLookup },
    ListAgentsUseCase,
    GetAgentDetailUseCase,
    ToggleAgentUseCase,
    ToggleAgentsInBulkUseCase,
    ChangeAgentConfigurationUseCase,
    AgentConfigurationAuditSubscriber,
  ],
  // Members (seat + agent) are created by the departments module.
  exports: [
    AGENT_REPOSITORY,
    AGENT_DIRECTORY_QUERY,
    PROVIDER_CONNECTION_LOOKUP,
    GetAgentDetailUseCase,
  ],
})
export class AgentsModule {}
