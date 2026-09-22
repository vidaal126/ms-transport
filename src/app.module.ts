import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "@common/logger/logger.module";
import { type Env, readEnv, validateEnv } from "@config/env";
import { CatalogSyncModule } from "@infrastructure/catalog-sync.module";
import { PrismaModule } from "@infrastructure/database/prisma/prisma.module";
import { HealthModule } from "@infrastructure/health/health.module";
import { GlobalExceptionFilter } from "@infrastructure/http/filters/global-exception.filter";
import { HttpThrottlerGuard } from "@infrastructure/http/guards/http-throttler.guard";
import { MessagingModule } from "@infrastructure/messaging/messaging.module";
import { TransportAvailabilityModule } from "@infrastructure/messaging/transport-availability.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: "default",
            ttl: readEnv(config, "THROTTLE_DEFAULT_TTL_MS"),
            limit: readEnv(config, "THROTTLE_DEFAULT_LIMIT"),
          },
        ],
      }),
    }),
    PrismaModule,
    MessagingModule,
    CatalogSyncModule,
    HealthModule,
    TransportAvailabilityModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
  ],
})
export class AppModule {}
