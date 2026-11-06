/** Something that happened in the domain; `type` is the event name (e.g. AgentConfigurationChanged). */
export interface DomainEvent {
  readonly type: string;
}

export const DOMAIN_EVENT_PUBLISHER = Symbol('DOMAIN_EVENT_PUBLISHER');

/** Application-facing port: use cases publish after their transaction committed. */
export interface DomainEventPublisher {
  publishDomainEvent(event: DomainEvent): void;
}
