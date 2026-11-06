export const APP_RUNTIME_CONFIG = Symbol('APP_RUNTIME_CONFIG');

/** Values fixed for the lifetime of one server launch. */
export interface AppRuntimeConfig {
  version: string;
  startedAtEpochMs: number;
  /** Random per-launch secret, exchanged once for the session cookie. */
  sessionToken: string;
  /** Port the server listens on; Host and Origin checks only accept this port. */
  listenPort: number;
}
