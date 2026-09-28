import type { ConfigService } from "@nestjs/config";
import type { Kafka } from "kafkajs";
import type { ILogger } from "@common/logger/logger.interface";
import type { Env } from "@config/env";
import type { DeadLetterPort, DeadLetterReason } from "@application/ports/dead-letter.port";
import { SyncCatalogItemUseCase } from "@application/use-cases/sync-catalog-item.use-case";
import { InvalidCatalogItemError } from "@domain/errors/catalog-item.errors";
import type { InboundMessage } from "@infrastructure/messaging/kafka-consumer.base";
import { InMemoryCatalogItemRepository } from "../../../test/catalog-item.fakes";
import { CatalogItemCreatedConsumer } from "./catalog-item-created.consumer";

class TestableConsumer extends CatalogItemCreatedConsumer {
  process(message: InboundMessage): Promise<void> {
    return this.handle(message);
  }
}

const silentLogger: ILogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const ITEM_ID = "2c58065b-1001-48c7-924e-70b1436a27e0";

const envValues: Partial<Env> = {
  CATALOG_SYNC_GROUP_ID: "ms-transport.catalog-item-sync",
  CONSUMER_RETRY_RETRIES: 5,
  CONSUMER_RETRY_INITIAL_MS: 300,
  CONSUMER_RETRY_MAX_MS: 30_000,
  CONSUMER_PAUSE_MS: 30_000,
};
const config: Pick<ConfigService<Env, true>, "get"> = {
  get: ((key: keyof Env) => envValues[key]) as ConfigService<Env, true>["get"],
};

function message(value: unknown): InboundMessage {
  return {
    topic: "catalog.ItemCreated",
    partition: 0,
    offset: "0",
    timestamp: "0",
    key: "k",
    value: typeof value === "string" ? Buffer.from(value) : Buffer.from(JSON.stringify(value)),
    headers: {},
  };
}

const v2 = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventId: "36e7f1e7-d189-480c-a72f-09a5fe4093c0",
  eventType: "ItemCreated",
  schemaVersion: 2,
  occurredAt: "2026-09-22T22:56:51.873Z",
  aggregateId: ITEM_ID,
  correlationId: "c",
  payload: {
    id: ITEM_ID,
    sku: "BOX-001",
    weightKg: 1.25,
    dimensions: { lengthCm: 30, widthCm: 20, heightCm: 10.5 },
  },
  ...overrides,
});

describe("CatalogItemCreatedConsumer.handle", () => {
  let repository: InMemoryCatalogItemRepository;
  let deadLetters: Array<{ reason: DeadLetterReason; offset: string }>;
  let consumer: TestableConsumer;

  beforeEach(() => {
    repository = new InMemoryCatalogItemRepository();
    deadLetters = [];
    const deadLetter: DeadLetterPort = {
      publish: async (m, reason: DeadLetterReason): Promise<void> => {
        deadLetters.push({ reason, offset: m.offset });
      },
      ensureTopic: async (): Promise<void> => undefined,
    };
    consumer = new TestableConsumer(
      {} as Kafka,
      silentLogger,
      new SyncCatalogItemUseCase(repository),
      deadLetter,
      config as ConfigService<Env, true>,
    );
  });

  it("evento valido: aplica no read model e nao vai para a DLT", async () => {
    await consumer.process(message(v2()));

    expect(repository.items.get(ITEM_ID)?.weightKg).toBe(1.25);
    expect(deadLetters).toHaveLength(0);
  });

  it("JSON invalido: DLT e retorna (offset commitado)", async () => {
    await expect(consumer.process(message("{nao json"))).resolves.toBeUndefined();

    expect(deadLetters).toEqual([{ reason: "invalid_json", offset: "0" }]);
  });

  it("invariante de dominio violada: DLT domain_invariant_violation", async () => {
    const invalid = v2({
      payload: { id: ITEM_ID, sku: "BOX-001", weightKg: 0, dimensions: { lengthCm: 1, widthCm: 1, heightCm: 1 } },
    });

    await expect(consumer.process(message(invalid))).resolves.toBeUndefined();

    expect(deadLetters).toEqual([{ reason: "domain_invariant_violation", offset: "0" }]);
    expect(repository.items.size).toBe(0);
  });

  it("dado rejeitado pelo banco (repositorio traduz para invariante): DLT", async () => {
    repository.syncError = new InvalidCatalogItemError("read model rejeitou o item");

    await expect(consumer.process(message(v2()))).resolves.toBeUndefined();

    expect(deadLetters).toEqual([{ reason: "domain_invariant_violation", offset: "0" }]);
  });

  it("erro recuperavel (banco fora): lanca para nao commitar, sem DLT", async () => {
    const down = new Error("Can't reach database server");
    repository.syncError = down;

    await expect(consumer.process(message(v2()))).rejects.toBe(down);
    expect(deadLetters).toHaveLength(0);
  });

  it("falha ao publicar na DLT: lanca (offset nao pode ser commitado)", async () => {
    const dltDown = new Error("broker indisponivel");
    const failingDeadLetter: DeadLetterPort = {
      publish: async (): Promise<void> => {
        throw dltDown;
      },
      ensureTopic: async (): Promise<void> => undefined,
    };
    const failing = new TestableConsumer(
      {} as Kafka,
      silentLogger,
      new SyncCatalogItemUseCase(repository),
      failingDeadLetter,
      config as ConfigService<Env, true>,
    );

    await expect(failing.process(message("{nao json"))).rejects.toBe(dltDown);
  });
});
