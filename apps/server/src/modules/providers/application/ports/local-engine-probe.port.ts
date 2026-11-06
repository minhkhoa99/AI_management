import type { LocalEngine } from '@aiteam/contracts';

export const LOCAL_ENGINE_PROBE = Symbol('LOCAL_ENGINE_PROBE');

export interface LocalEngineProbeResult {
  installed: boolean;
  version: string | null;
  signedIn: boolean | null;
  accountDetail: string | null;
  problem: string | null;
}

/** Checks a local CLI: installed, version, signed in. Never throws for a missing CLI. */
export interface LocalEngineProbe {
  probeLocalEngine(engine: LocalEngine): Promise<LocalEngineProbeResult>;
}
