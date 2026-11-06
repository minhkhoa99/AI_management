export const APP_RUNTIME_CONFIG = Symbol('APP_RUNTIME_CONFIG');

/** Values fixed for the lifetime of one server launch. */
export interface AppRuntimeConfig {
  version: string;
  startedAtEpochMs: number;
  /** Random per-launch secret the browser must send on every API call. */
  sessionToken: string;
}
