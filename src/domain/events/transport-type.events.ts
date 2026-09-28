import type { DomainEvent } from "./domain-event";

// Estado completo do tipo de transporte no momento do fato: consumidores
// (ms-customer, ms-sales-order) mantem replica local so com o ultimo estado.
export interface TransportTypeSnapshot {
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
}

export class TransportTypeCreatedEvent implements DomainEvent {
  static readonly EVENT_TYPE = "TransportTypeCreated";

  readonly eventType = TransportTypeCreatedEvent.EVENT_TYPE;

  constructor(
    readonly aggregateId: string,
    readonly occurredAt: Date,
    readonly snapshot: TransportTypeSnapshot,
  ) {}
}

export class TransportTypeUpdatedEvent implements DomainEvent {
  static readonly EVENT_TYPE = "TransportTypeUpdated";

  readonly eventType = TransportTypeUpdatedEvent.EVENT_TYPE;

  constructor(
    readonly aggregateId: string,
    readonly occurredAt: Date,
    readonly snapshot: TransportTypeSnapshot,
  ) {}
}

export type TransportTypeEvent = TransportTypeCreatedEvent | TransportTypeUpdatedEvent;
