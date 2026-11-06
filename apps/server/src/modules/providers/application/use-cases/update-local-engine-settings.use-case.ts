import { Inject, Injectable } from '@nestjs/common';
import type {
  LocalEngine,
  LocalEngineSettings,
  UpdateLocalEngineSettingsRequest,
} from '@aiteam/contracts';
import {
  LOCAL_ENGINE_SETTINGS_REPOSITORY,
  type LocalEngineSettingsRepository,
} from '../../domain/repositories/local-engine-settings.repository';

@Injectable()
export class UpdateLocalEngineSettingsUseCase {
  constructor(
    @Inject(LOCAL_ENGINE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: LocalEngineSettingsRepository,
  ) {}

  updateLocalEngineSettings(
    engine: LocalEngine,
    request: UpdateLocalEngineSettingsRequest,
  ): LocalEngineSettings {
    const settings = { ...this.settingsRepository.readLocalEngineSettings(engine), ...request };
    this.settingsRepository.saveLocalEngineSettings(engine, settings);
    return settings;
  }
}
