import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { GetCatalogItemUseCase } from "@application/use-cases/get-catalog-item.use-case";
import type { CatalogItemResponseDto } from "./dto/catalog-item-response.dto";
import { toCatalogItemResponse } from "./mappers/catalog-item-response.mapper";

// Leitura do read model para verificacao; a entidade nao e exposta.
@Controller("catalog-items")
export class CatalogItemController {
  constructor(private readonly getCatalogItem: GetCatalogItemUseCase) {}

  @Get(":itemId")
  async findById(
    @Param("itemId", ParseUUIDPipe) itemId: string,
  ): Promise<CatalogItemResponseDto> {
    return toCatalogItemResponse(await this.getCatalogItem.execute(itemId));
  }
}
