import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "@common/logger/logger.module";
import { PrismaModule } from "@infrastructure/database/prisma/prisma.module";
import { TransportTypeModule } from "@infrastructure/http/transport-type.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    PrismaModule,
    TransportTypeModule,
  ],
})
export class AppModule {}
