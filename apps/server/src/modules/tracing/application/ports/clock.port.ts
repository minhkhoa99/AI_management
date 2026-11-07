export const CLOCK = Symbol('CLOCK');

/** Source of "now"; tests pin it. */
export interface Clock {
  currentTime(): Date;
}
