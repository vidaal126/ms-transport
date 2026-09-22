import type { CatalogItem } from "@domain/entities/catalog-item.entity";
import type {
  ICatalogItemRepository,
  SourceEvent,
  SyncOutcome,
} from "@domain/repositories/catalog-item.repository";

// Mesma semantica do adapter Prisma, em memoria.
export class InMemoryCatalogItemRepository implements ICatalogItemRepository {
  readonly items = new Map<string, CatalogItem>();
  readonly processed = new Set<string>();
  syncError: Error | undefined;

  async findById(itemId: string): Promise<CatalogItem | undefined> {
    return this.items.get(itemId);
  }

  async syncFromEvent(item: CatalogItem, event: SourceEvent): Promise<SyncOutcome> {
    if (this.syncError) throw this.syncError;
    if (this.processed.has(event.eventId)) return "duplicate";
    this.processed.add(event.eventId);

    const current = this.items.get(item.itemId);
    if (current && current.sourceOccurredAt >= item.sourceOccurredAt) return "stale";
    this.items.set(item.itemId, item);
    return "applied";
  }
}
