import { Module } from "@nestjs/common";
import { CreateTransportTypeUseCase } from "../../application/use-cases/create-transport-type.use-case";
import { TRANSPORT_TYPE_REPOSITORY } from "../../domain/repositories/transport-type.repository";
import { TransportTypeRepositoryPrisma } from "../database/repositories/transport-type.repository";
import { TransportTypeController } from "./transport-type.controller";

@Module({
  controllers: [TransportTypeController],
  providers: [
    CreateTransportTypeUseCase,
    {
      provide: TRANSPORT_TYPE_REPOSITORY,
      useClass: TransportTypeRepositoryPrisma,
    },
  ],
  exports: [TRANSPORT_TYPE_REPOSITORY],
})
export class TransportTypeModule {}
