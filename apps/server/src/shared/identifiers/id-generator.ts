import { randomUUID } from 'node:crypto';

export const ID_GENERATOR = Symbol('ID_GENERATOR');

/** Source of new entity ids; injected so tests can make ids predictable. */
export interface IdGenerator {
  generateId(): string;
}

export const randomUuidGenerator: IdGenerator = {
  generateId: () => randomUUID(),
};
