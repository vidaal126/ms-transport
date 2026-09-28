import type { SyncOutcome } from "./catalog-item.repository.port";

export const SYNC_CATALOG_ITEM = Symbol("SYNC_CATALOG_ITEM");

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

// Port de entrada: o adapter Kafka entrega o evento decodificado.
// Lanca InvariantViolationError se o evento violar as regras do dominio;
// qualquer outro erro e tratado como recuperavel pelo adapter.
export interface SyncCatalogItemPort {
  execute(event: CatalogItemEvent): Promise<SyncOutcome>;
}
