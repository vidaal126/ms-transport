import { Module } from "@nestjs/common";
import {
  type ITransportTypeRepository,
  TRANSPORT_TYPE_REPOSITORY,
} from "@application/ports/transport-type.repository.port";
import {
  CreateTransportTypeUseCase,
  GetTransportTypeUseCase,
  ListTransportTypesUseCase,
  UpdateTransportTypeUseCase,
} from "@application/use-cases/transport-type.use-cases";
import { TransportTypeRepositoryPrisma } from "@infrastructure/database/repositories/transport-type.repository";
import { TransportTypeController } from "@infrastructure/http/transport-type.controller";
import { MessagingModule } from "@infrastructure/messaging/messaging.module";
import { OutboxPublisherService } from "@infrastructure/outbox/outbox-publisher.service";
import { OutboxRepository } from "@infrastructure/outbox/outbox.repository";

// Dono do tipo de transporte: CRUD via HTTP e publicacao dos eventos
// transport.TransportType* via Transactional Outbox.
@Module({
  imports: [MessagingModule],
  controllers: [TransportTypeController],
  providers: [
    { provide: TRANSPORT_TYPE_REPOSITORY, useClass: TransportTypeRepositoryPrisma },
    ...[
      CreateTransportTypeUseCase,
      UpdateTransportTypeUseCase,
      GetTransportTypeUseCase,
      ListTransportTypesUseCase,
    ].map((useCase) => ({
      provide: useCase,
      useFactory: (repository: ITransportTypeRepository) => new useCase(repository),
      inject: [TRANSPORT_TYPE_REPOSITORY],
    })),
    OutboxRepository,
    OutboxPublisherService,
  ],
})
export class TransportTypeModule {}
