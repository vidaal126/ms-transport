import type { CatalogItem } from "@domain/entities/catalog-item.entity";
import type { CatalogItemResponseDto } from "@infrastructure/http/dto/catalog-item-response.dto";

export function toCatalogItemResponse(item: CatalogItem): CatalogItemResponseDto {
  return {
    itemId: item.itemId,
    sku: item.sku,
    weightKg: item.weightKg,
    dimensions: item.dimensions.toPrimitives(),
    sourceEventId: item.sourceEventId,
    sourceOccurredAt: item.sourceOccurredAt.toISOString(),
  };
}
