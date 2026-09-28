import type { Prisma } from "@infrastructure/database/generated/client";
import type { TransportTypeEvent } from "@domain/events/transport-type.events";
import type { PersistenceContext } from "@application/ports/transport-type.repository.port";

// Versao do contrato publicado (envelope v2: schemaVersion no envelope).
export const TRANSPORT_TYPE_EVENTS_SCHEMA_VERSION = 2;

export function toOutboxEventData(
  event: TransportTypeEvent,
  context: PersistenceContext,
): Prisma.OutboxEventCreateManyInput {
  const payload: Prisma.InputJsonObject = {
    id: event.aggregateId,
    name: event.snapshot.name,
    description: event.snapshot.description,
    active: event.snapshot.active,
  };

  return {
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    schemaVersion: TRANSPORT_TYPE_EVENTS_SCHEMA_VERSION,
    correlationId: context.correlationId,
    payload,
    createdAt: event.occurredAt,
  };
}
