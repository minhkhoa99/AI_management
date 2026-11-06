import type { AppLogger } from '../logging/app-logger';
import type { DomainEvent, DomainEventPublisher } from './domain-event';

type DomainEventHandler = (event: DomainEvent) => void;

/**
 * Synchronous in-process bus (single Node process, no broker). A failing handler is logged with
 * the event and does not stop other handlers or the use case that already committed its work.
 */
export class InProcessDomainEventBus implements DomainEventPublisher {
  private readonly handlersByType = new Map<string, Set<DomainEventHandler>>();

  constructor(private readonly logger: AppLogger) {}

  subscribeToDomainEvent<Event extends DomainEvent>(
    eventType: Event['type'],
    handleEvent: (event: Event) => void,
  ): () => void {
    const handlers = this.handlersByType.get(eventType) ?? new Set<DomainEventHandler>();
    const handler = handleEvent as DomainEventHandler;
    handlers.add(handler);
    this.handlersByType.set(eventType, handlers);
    return () => handlers.delete(handler);
  }

  publishDomainEvent(event: DomainEvent): void {
    for (const handler of this.handlersByType.get(event.type) ?? []) {
      try {
        handler(event);
      } catch (error) {
        this.logger.error({ err: error, domainEvent: event }, 'domain event handler failed');
      }
    }
  }
}
