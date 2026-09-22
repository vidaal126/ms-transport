import type { CatalogItemProps } from "@domain/entities/catalog-item.entity";

export function buildCatalogItemProps(
  overrides: Partial<CatalogItemProps> = {},
): CatalogItemProps {
  return {
    itemId: "b8a91f43-8755-4815-bd61-bb3b15760af0",
    sku: "BOX-001",
    weightKg: 0.75,
    dimensions: { lengthCm: 40, widthCm: 30, heightCm: 25 },
    sourceEventId: "evt-1",
    sourceOccurredAt: new Date("2026-09-03T01:56:10.122Z"),
    ...overrides,
  };
}
