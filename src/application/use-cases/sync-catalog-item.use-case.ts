import { CatalogItem } from "@domain/entities/catalog-item.entity";
import type {
  ICatalogItemRepository,
  SyncOutcome,
} from "@application/ports/catalog-item.repository.port";
import type {
  CatalogItemEvent,
  SyncCatalogItemPort,
} from "@application/ports/sync-catalog-item.port";

export class SyncCatalogItemUseCase implements SyncCatalogItemPort {
  constructor(private readonly catalogItemRepository: ICatalogItemRepository) {}

  // Lanca InvariantViolationError se o evento violar as regras do dominio.
  async execute(event: CatalogItemEvent): Promise<SyncOutcome> {
    const item = CatalogItem.fromCatalogEvent({
      itemId: event.itemId,
      sku: event.sku,
      weightKg: event.weightKg,
      dimensions: event.dimensions,
      sourceEventId: event.eventId,
      sourceOccurredAt: event.occurredAt,
    });

    return this.catalogItemRepository.syncFromEvent(item, {
      eventId: event.eventId,
      eventType: event.eventType,
    });
  }
}
