'use client';

import { useCallback, useRef } from 'react';
import type { CliUpdateNotice, LocalEngine, LocalEngineModelChoice } from '@aiteam/contracts';
import { useApiQuery } from '../../shared/api/use-api-query';
import { loadLocalEngineModels } from './providers-api';

export interface LocalEngineModels {
  choices: LocalEngineModelChoice[];
  problem: string | null;
  cliUpdate: CliUpdateNotice | null;
  loading: boolean;
  /** Reads the CLI's list again (skips the server's 60-second cache). */
  refreshModels: () => void;
}

/** The installed CLI's model list, read each time a form showing it opens. */
export function useLocalEngineModels(engine: LocalEngine): LocalEngineModels {
  const refreshNextLoad = useRef(false);
  const modelList = useApiQuery(`local-engine-models:${engine}`, () => {
    const refresh = refreshNextLoad.current;
    refreshNextLoad.current = false;
    return loadLocalEngineModels(engine, { refresh });
  });
  const { reload } = modelList;
  const refreshModels = useCallback(() => {
    refreshNextLoad.current = true;
    reload();
  }, [reload]);
  const list = modelList.status === 'success' ? modelList.result : null;
  return {
    choices: list?.models ?? [],
    problem: list?.problem ?? null,
    cliUpdate: list?.cliUpdate ?? null,
    loading: modelList.status === 'loading',
    refreshModels,
  };
}
