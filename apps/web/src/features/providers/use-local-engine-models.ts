'use client';

import { useCallback, useRef, useState } from 'react';
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
  // useApiQuery keeps the old list on screen while reloading; ↻ needs to show it is reading.
  const [refreshing, setRefreshing] = useState(false);
  const modelList = useApiQuery(`local-engine-models:${engine}`, () => {
    const refresh = refreshNextLoad.current;
    refreshNextLoad.current = false;
    const pending = loadLocalEngineModels(engine, { refresh });
    return refresh ? pending.finally(() => setRefreshing(false)) : pending;
  });
  const { reload } = modelList;
  const refreshModels = useCallback(() => {
    refreshNextLoad.current = true;
    setRefreshing(true);
    reload();
  }, [reload]);
  const list = modelList.status === 'success' ? modelList.result : null;
  return {
    choices: list?.models ?? [],
    problem:
      modelList.status === 'error'
        ? `Không tải được danh sách model: ${modelList.error.message}`
        : (list?.problem ?? null),
    cliUpdate: list?.cliUpdate ?? null,
    loading: modelList.status === 'loading' || refreshing,
    refreshModels,
  };
}
