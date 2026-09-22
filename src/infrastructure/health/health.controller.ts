import { Controller, Get } from "@nestjs/common";
import { HealthCheck, type HealthCheckResult, HealthCheckService } from "@nestjs/terminus";
import { SkipThrottle } from "@nestjs/throttler";
import { KafkaHealthIndicator } from "@infrastructure/messaging/kafka.health";
import { CatalogConsumerHealthIndicator } from "./catalog-consumer.health";
import { PrismaHealthIndicator } from "./prisma.health";
import { RabbitMqHealthIndicator } from "./rabbitmq.health";

@Controller("health")
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: PrismaHealthIndicator,
    private readonly kafka: KafkaHealthIndicator,
    private readonly consumer: CatalogConsumerHealthIndicator,
    private readonly rabbitmq: RabbitMqHealthIndicator,
  ) {}

  // Liveness: o processo responde. Nao checa dependencias, para que uma
  // queda do banco/broker nao provoque restart em cascata.
  @Get("live")
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  // Readiness: banco, broker Kafka, consumer do read model e RabbitMQ.
  @Get("ready")
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.isHealthy("database"),
      () => this.kafka.isHealthy("kafka"),
      () => this.consumer.isHealthy("catalogConsumer"),
      () => this.rabbitmq.isHealthy("rabbitmq"),
    ]);
  }
}
