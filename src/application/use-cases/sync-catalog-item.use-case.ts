import { Inject, Injectable } from "@nestjs/common";
import { CatalogItem } from "@domain/entities/catalog-item.entity";
import {
  CATALOG_ITEM_REPOSITORY,
  type ICatalogItemRepository,
  type SyncOutcome,
} from "@domain/repositories/catalog-item.repository";

// Evento de catalogo ja normalizado (qualquer versao de schema suportada).
export interface CatalogItemEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly itemId: string;
  readonly sku: string;
  readonly weightKg: number;
  readonly dimensions: {
    readonly lengthCm: number;
    readonly widthCm: number;
    readonly heightCm: number;
  };
}

@Injectable()
export class SyncCatalogItemUseCase {
  constructor(
    @Inject(CATALOG_ITEM_REPOSITORY)
    private readonly catalogItemRepository: ICatalogItemRepository,
  ) {}

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
