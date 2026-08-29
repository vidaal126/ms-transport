import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "@common/logger/logger.module";
import { PrismaModule } from "@infrastructure/database/prisma/prisma.module";
import { TransportAvailabilityModule } from "@infrastructure/messaging/transport-availability.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    PrismaModule,
    TransportAvailabilityModule,
  ],
})
export class AppModule {}
