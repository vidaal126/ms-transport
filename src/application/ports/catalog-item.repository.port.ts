import type { CatalogItem } from "@domain/entities/catalog-item.entity";

export const CATALOG_ITEM_REPOSITORY = Symbol("CATALOG_ITEM_REPOSITORY");

export interface SourceEvent {
  readonly eventId: string;
  readonly eventType: string;
}

// applied: item gravado ou atualizado.
// duplicate: eventId ja processado; nada muda.
// stale: evento novo, mas mais antigo (ou igual) ao que gerou a versao atual.
export type SyncOutcome = "applied" | "duplicate" | "stale";

export interface ICatalogItemRepository {
  findById(itemId: string): Promise<CatalogItem | undefined>;
  // Registra o evento como processado e aplica o item na MESMA transacao:
  // ou os dois acontecem, ou nenhum (e o offset nao deve ser commitado).
  syncFromEvent(item: CatalogItem, event: SourceEvent): Promise<SyncOutcome>;
}
