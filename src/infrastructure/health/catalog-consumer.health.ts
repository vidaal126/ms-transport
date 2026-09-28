import { Injectable } from "@nestjs/common";
import { type HealthIndicatorResult, HealthIndicatorService } from "@nestjs/terminus";
import { CatalogItemCreatedConsumer } from "@infrastructure/messaging/catalog/catalog-item-created.consumer";

// Pronto so quando o consumer esta consumindo: degradado (retry esgotado,
// banco ou broker fora) ou ainda entrando no grupo = down. O erro em si fica
// no log de crash; aqui so status e desde quando.
@Injectable()
export class CatalogConsumerHealthIndicator {
  constructor(
    private readonly consumer: CatalogItemCreatedConsumer,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  isHealthy<const K extends string>(key: K): HealthIndicatorResult<K> {
    const indicator = this.healthIndicatorService.check(key);
    const { status, since } = this.consumer.getHealth();
    const data = { consumerStatus: status, since: since.toISOString() };
    return status === "running" ? indicator.up(data) : indicator.down(data);
  }
}
