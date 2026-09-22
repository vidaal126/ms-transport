import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { CatalogSyncModule } from "@infrastructure/catalog-sync.module";
import { MessagingModule } from "@infrastructure/messaging/messaging.module";
import { CatalogConsumerHealthIndicator } from "./catalog-consumer.health";
import { HealthController } from "./health.controller";
import { PrismaHealthIndicator } from "./prisma.health";
import { RabbitMqHealthIndicator } from "./rabbitmq.health";

@Module({
  imports: [TerminusModule, MessagingModule, CatalogSyncModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, CatalogConsumerHealthIndicator, RabbitMqHealthIndicator],
})
export class HealthModule {}
