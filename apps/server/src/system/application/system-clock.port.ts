export const SYSTEM_CLOCK = Symbol('SYSTEM_CLOCK');

export interface SystemClock {
  nowEpochMs(): number;
}

export const wallClock: SystemClock = {
  nowEpochMs: () => Date.now(),
};
