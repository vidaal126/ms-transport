import { Module } from "@nestjs/common";
import { SyncCatalogItemUseCase } from "@application/use-cases/sync-catalog-item.use-case";
import { CATALOG_ITEM_REPOSITORY } from "@domain/repositories/catalog-item.repository";
import { CatalogItemRepositoryPrisma } from "@infrastructure/database/repositories/catalog-item.repository";
import { CatalogItemCreatedConsumer } from "@infrastructure/messaging/catalog/catalog-item-created.consumer";
import { MessagingModule } from "@infrastructure/messaging/messaging.module";

// Read model de itens do catalogo: consumer Kafka -> use case -> Prisma.
@Module({
  imports: [MessagingModule],
  providers: [
    { provide: CATALOG_ITEM_REPOSITORY, useClass: CatalogItemRepositoryPrisma },
    SyncCatalogItemUseCase,
    CatalogItemCreatedConsumer,
  ],
  exports: [CATALOG_ITEM_REPOSITORY, CatalogItemCreatedConsumer],
})
export class CatalogSyncModule {}
