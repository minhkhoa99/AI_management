import type { LocalEngine, LocalEngineSettings } from '@aiteam/contracts';

export const LOCAL_ENGINE_SETTINGS_REPOSITORY = Symbol('LOCAL_ENGINE_SETTINGS_REPOSITORY');

export interface LocalEngineSettingsRepository {
  readLocalEngineSettings(engine: LocalEngine): LocalEngineSettings;
  saveLocalEngineSettings(engine: LocalEngine, settings: LocalEngineSettings): void;
}
