import { CatalogItem } from "@domain/entities/catalog-item.entity";
import { CatalogItemNotFoundError } from "@domain/errors/catalog-item.errors";
import { buildCatalogItemProps } from "../../test/catalog-item.fixtures";
import { InMemoryCatalogItemRepository } from "../../test/catalog-item.fakes";
import { GetCatalogItemUseCase } from "./get-catalog-item.use-case";

describe("GetCatalogItemUseCase", () => {
  it("retorna o item do read model", async () => {
    const repository = new InMemoryCatalogItemRepository();
    const item = CatalogItem.restore(buildCatalogItemProps());
    repository.items.set(item.itemId, item);

    await expect(new GetCatalogItemUseCase(repository).execute(item.itemId)).resolves.toBe(item);
  });

  it("lanca CatalogItemNotFoundError quando nao existe", async () => {
    const useCase = new GetCatalogItemUseCase(new InMemoryCatalogItemRepository());

    await expect(useCase.execute("nao-existe")).rejects.toBeInstanceOf(CatalogItemNotFoundError);
  });
});
