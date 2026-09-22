import { Inject, Injectable } from "@nestjs/common";
import type { CatalogItem } from "@domain/entities/catalog-item.entity";
import { CatalogItemNotFoundError } from "@domain/errors/catalog-item.errors";
import {
  CATALOG_ITEM_REPOSITORY,
  type ICatalogItemRepository,
} from "@domain/repositories/catalog-item.repository";

@Injectable()
export class GetCatalogItemUseCase {
  constructor(
    @Inject(CATALOG_ITEM_REPOSITORY)
    private readonly catalogItemRepository: ICatalogItemRepository,
  ) {}

  async execute(itemId: string): Promise<CatalogItem> {
    const item = await this.catalogItemRepository.findById(itemId);
    if (!item) {
      throw new CatalogItemNotFoundError(itemId);
    }
    return item;
  }
}
