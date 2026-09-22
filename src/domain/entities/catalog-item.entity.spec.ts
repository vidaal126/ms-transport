import { InvariantViolationError } from "@domain/errors/domain.error";
import { buildCatalogItemProps } from "../../test/catalog-item.fixtures";
import { CatalogItem } from "./catalog-item.entity";

describe("CatalogItem.fromCatalogEvent", () => {
  it("cria o item com os dados do evento", () => {
    const item = CatalogItem.fromCatalogEvent(buildCatalogItemProps());

    expect(item.itemId).toBe("b8a91f43-8755-4815-bd61-bb3b15760af0");
    expect(item.weightKg).toBe(0.75);
    expect(item.dimensions.toPrimitives()).toEqual({
      lengthCm: 40,
      widthCm: 30,
      heightCm: 25,
    });
  });

  it.each([
    ["weightKg zero", { weightKg: 0 }],
    ["weightKg acima do maximo", { weightKg: 1000.001 }],
    ["weightKg com 4 casas", { weightKg: 1.2345 }],
    ["dimensao zero", { dimensions: { lengthCm: 0, widthCm: 1, heightCm: 1 } }],
    ["sku vazio", { sku: " " }],
    ["itemId vazio", { itemId: "" }],
  ])("%s viola invariante do dominio", (_label, override) => {
    let caught: unknown;
    try {
      CatalogItem.fromCatalogEvent(buildCatalogItemProps(override));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(InvariantViolationError);
  });
});
