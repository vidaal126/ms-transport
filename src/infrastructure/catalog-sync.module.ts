import { Module } from "@nestjs/common";
import { GetCatalogItemUseCase } from "@application/use-cases/get-catalog-item.use-case";
import { SyncCatalogItemUseCase } from "@application/use-cases/sync-catalog-item.use-case";
import {
  CATALOG_ITEM_REPOSITORY,
  type ICatalogItemRepository,
} from "@application/ports/catalog-item.repository.port";
import { DEAD_LETTER_PORT } from "@application/ports/dead-letter.port";
import { SYNC_CATALOG_ITEM } from "@application/ports/sync-catalog-item.port";
import { CatalogItemRepositoryPrisma } from "@infrastructure/database/repositories/catalog-item.repository";
import { CatalogItemController } from "@infrastructure/http/catalog-item.controller";
import { CatalogItemCreatedConsumer } from "@infrastructure/messaging/catalog/catalog-item-created.consumer";
import { DeadLetterPublisher } from "@infrastructure/messaging/dead-letter.publisher";
import { MessagingModule } from "@infrastructure/messaging/messaging.module";

// Read model de itens do catalogo: consumer Kafka -> use case -> Prisma, e
// leitura via HTTP.
@Module({
  imports: [MessagingModule],
  controllers: [CatalogItemController],
  providers: [
    { provide: CATALOG_ITEM_REPOSITORY, useClass: CatalogItemRepositoryPrisma },
    // Use cases nao conhecem Nest: a composicao fica aqui.
    {
      provide: SYNC_CATALOG_ITEM,
      useFactory: (repository: ICatalogItemRepository) =>
        new SyncCatalogItemUseCase(repository),
      inject: [CATALOG_ITEM_REPOSITORY],
    },
    {
      provide: GetCatalogItemUseCase,
      useFactory: (repository: ICatalogItemRepository) =>
        new GetCatalogItemUseCase(repository),
      inject: [CATALOG_ITEM_REPOSITORY],
    },
    { provide: DEAD_LETTER_PORT, useExisting: DeadLetterPublisher },
    CatalogItemCreatedConsumer,
  ],
  exports: [CATALOG_ITEM_REPOSITORY, CatalogItemCreatedConsumer],
})
export class CatalogSyncModule {}
