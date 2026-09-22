import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "@common/logger/logger.module";
import { type Env, readEnv, validateEnv } from "@config/env";
import { PrismaModule } from "@infrastructure/database/prisma/prisma.module";
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
    TransportAvailabilityModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}
