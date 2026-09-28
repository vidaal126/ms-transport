import { HealthIndicatorService } from "@nestjs/terminus";
import type { ConsumerStatus } from "@infrastructure/messaging/kafka-consumer.base";
import type { CatalogItemCreatedConsumer } from "@infrastructure/messaging/catalog/catalog-item-created.consumer";
import { CatalogConsumerHealthIndicator } from "./catalog-consumer.health";

function indicatorFor(status: ConsumerStatus): CatalogConsumerHealthIndicator {
  const consumer: Pick<CatalogItemCreatedConsumer, "getHealth"> = {
    getHealth: () => ({
      status,
      since: new Date("2026-09-22T12:00:00.000Z"),
      lastError: "Can't reach database server at localhost:5435",
    }),
  };
  return new CatalogConsumerHealthIndicator(
    consumer as CatalogItemCreatedConsumer,
    new HealthIndicatorService(),
  );
}

describe("CatalogConsumerHealthIndicator", () => {
  it("running: up", () => {
    expect(indicatorFor("running").isHealthy("catalogConsumer").catalogConsumer.status).toBe("up");
  });

  it.each<ConsumerStatus>(["starting", "degraded", "stopped"])("%s: down", (status) => {
    expect(indicatorFor(status).isHealthy("catalogConsumer").catalogConsumer.status).toBe("down");
  });

  it("nao expoe a mensagem de erro do consumer", () => {
    const result = indicatorFor("degraded").isHealthy("catalogConsumer");

    expect(JSON.stringify(result)).not.toContain("localhost");
  });
});
