import type { CatalogItem } from "@domain/entities/catalog-item.entity";
import { CatalogItemNotFoundError } from "@domain/errors/catalog-item.errors";
import type { ICatalogItemRepository } from "@application/ports/catalog-item.repository.port";

export class GetCatalogItemUseCase {
  constructor(private readonly catalogItemRepository: ICatalogItemRepository) {}

  async execute(itemId: string): Promise<CatalogItem> {
    const item = await this.catalogItemRepository.findById(itemId);
    if (!item) {
      throw new CatalogItemNotFoundError(itemId);
    }
    return item;
  }
}
