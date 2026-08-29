import { Module } from "@nestjs/common";
import { TRANSPORT_TYPE_REPOSITORY } from "../../domain/repositories/transport-type.repository";
import { TransportTypeRepositoryPrisma } from "../database/repositories/transport-type.repository";
import { TransportAvailabilityController } from "./transport-availability.controller";

@Module({
  controllers: [TransportAvailabilityController],
  providers: [
    {
      provide: TRANSPORT_TYPE_REPOSITORY,
      useClass: TransportTypeRepositoryPrisma,
    },
  ],
})
export class TransportAvailabilityModule {}
