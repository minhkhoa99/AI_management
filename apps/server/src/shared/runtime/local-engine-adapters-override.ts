import type { AntigravityModelCatalog } from '../../modules/providers/application/ports/antigravity-model-catalog.port';
import type { ClaudeModelCatalog } from '../../modules/providers/application/ports/claude-model-catalog.port';
import type { CliUpdateChecker } from '../../modules/providers/application/ports/cli-update-checker.port';
import type { CodexModelCatalog } from '../../modules/providers/application/ports/codex-model-catalog.port';
import type { EngineQuotaReader } from '../../modules/providers/application/ports/engine-quota-reader.port';
import type { LocalEngineProbe } from '../../modules/providers/application/ports/local-engine-probe.port';

export const LOCAL_ENGINE_ADAPTERS_OVERRIDE = Symbol('LOCAL_ENGINE_ADAPTERS_OVERRIDE');

/**
 * Tests replace the adapters that spawn the developer's real CLIs (probe, model catalogs) or reach
 * the network (CLI update check) so they never depend on what is installed. Each member is optional; always null in the running application.
 */
export type LocalEngineAdaptersOverride = Partial<{
  probe: LocalEngineProbe;
  claudeModelCatalog: ClaudeModelCatalog;
  codexModelCatalog: CodexModelCatalog;
  antigravityModelCatalog: AntigravityModelCatalog;
  quotaReaders: EngineQuotaReader[];
  cliUpdateChecker: CliUpdateChecker;
}> | null;
