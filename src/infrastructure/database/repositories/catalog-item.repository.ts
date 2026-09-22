import { Injectable } from "@nestjs/common";
import type { CatalogItem as CatalogItemModel } from "@infrastructure/database/generated/client";
import { CatalogItem } from "@domain/entities/catalog-item.entity";
import type {
  ICatalogItemRepository,
  SourceEvent,
  SyncOutcome,
} from "@domain/repositories/catalog-item.repository";
import { PrismaService } from "@infrastructure/database/prisma/prisma.service";

@Injectable()
export class CatalogItemRepositoryPrisma implements ICatalogItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(itemId: string): Promise<CatalogItem | undefined> {
    const found = await this.prisma.catalogItem.findUnique({ where: { itemId } });
    if (!found) return undefined;
    return this.toDomain(found);
  }

  async syncFromEvent(item: CatalogItem, event: SourceEvent): Promise<SyncOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING na PK: count 0 = eventId ja processado.
      const registered = await tx.processedEvent.createMany({
        data: [{ eventId: event.eventId, eventType: event.eventType }],
        skipDuplicates: true,
      });
      if (registered.count === 0) return "duplicate";

      // Upsert condicional: so sobrescreve se o evento for mais recente que o
      // que gerou a versao gravada (protege contra reordenacao em replay).
      // Com conflito e WHERE falso, nenhuma linha e afetada.
      const affected = await tx.$executeRaw`
        INSERT INTO "catalog_items" (
          "itemId", "sku", "weightKg", "lengthCm", "widthCm", "heightCm",
          "sourceEventId", "sourceOccurredAt", "createdAt", "updatedAt"
        ) VALUES (
          ${item.itemId}, ${item.sku}, ${item.weightKg},
          ${item.dimensions.lengthCm}, ${item.dimensions.widthCm}, ${item.dimensions.heightCm},
          ${item.sourceEventId}, ${item.sourceOccurredAt},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("itemId") DO UPDATE SET
          "sku" = EXCLUDED."sku",
          "weightKg" = EXCLUDED."weightKg",
          "lengthCm" = EXCLUDED."lengthCm",
          "widthCm" = EXCLUDED."widthCm",
          "heightCm" = EXCLUDED."heightCm",
          "sourceEventId" = EXCLUDED."sourceEventId",
          "sourceOccurredAt" = EXCLUDED."sourceOccurredAt",
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "catalog_items"."sourceOccurredAt" < EXCLUDED."sourceOccurredAt"
      `;

      return affected === 1 ? "applied" : "stale";
    });
  }

  private toDomain(raw: CatalogItemModel): CatalogItem {
    return CatalogItem.restore({
      itemId: raw.itemId,
      sku: raw.sku,
      weightKg: raw.weightKg.toNumber(),
      dimensions: {
        lengthCm: raw.lengthCm.toNumber(),
        widthCm: raw.widthCm.toNumber(),
        heightCm: raw.heightCm.toNumber(),
      },
      sourceEventId: raw.sourceEventId,
      sourceOccurredAt: raw.sourceOccurredAt,
    });
  }
}
