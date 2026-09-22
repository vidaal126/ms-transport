import type { ConfigService } from "@nestjs/config";
import type { Kafka } from "kafkajs";
import type { ILogger } from "@common/logger/logger.interface";
import type { Env } from "@config/env";
import { SyncCatalogItemUseCase } from "@application/use-cases/sync-catalog-item.use-case";
import type {
  DeadLetterPublisher,
  DeadLetterReason,
} from "@infrastructure/messaging/dead-letter.publisher";
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

const envValues: Partial<Env> = {
  CONSUMER_RETRY_RETRIES: 5,
  CONSUMER_RETRY_INITIAL_MS: 300,
  CONSUMER_RETRY_MAX_MS: 30_000,
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
  aggregateId: "item-1",
  correlationId: "c",
  payload: {
    id: "item-1",
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
    const deadLetter: Pick<DeadLetterPublisher, "publish" | "ensureTopic"> = {
      publish: async (m: InboundMessage, reason: DeadLetterReason): Promise<void> => {
        deadLetters.push({ reason, offset: m.offset });
      },
      ensureTopic: async (): Promise<void> => undefined,
    };
    consumer = new TestableConsumer(
      {} as Kafka,
      silentLogger,
      new SyncCatalogItemUseCase(repository),
      deadLetter as DeadLetterPublisher,
      config as ConfigService<Env, true>,
    );
  });

  it("evento valido: aplica no read model e nao vai para a DLT", async () => {
    await consumer.process(message(v2()));

    expect(repository.items.get("item-1")?.weightKg).toBe(1.25);
    expect(deadLetters).toHaveLength(0);
  });

  it("JSON invalido: DLT e retorna (offset commitado)", async () => {
    await expect(consumer.process(message("{nao json"))).resolves.toBeUndefined();

    expect(deadLetters).toEqual([{ reason: "invalid_json", offset: "0" }]);
  });

  it("invariante de dominio violada: DLT domain_invariant_violation", async () => {
    const invalid = v2({
      payload: { id: "item-1", sku: "BOX-001", weightKg: 0, dimensions: { lengthCm: 1, widthCm: 1, heightCm: 1 } },
    });

    await expect(consumer.process(message(invalid))).resolves.toBeUndefined();

    expect(deadLetters).toEqual([{ reason: "domain_invariant_violation", offset: "0" }]);
    expect(repository.items.size).toBe(0);
  });

  it("erro recuperavel (banco fora): lanca para nao commitar, sem DLT", async () => {
    const down = new Error("Can't reach database server");
    repository.syncError = down;

    await expect(consumer.process(message(v2()))).rejects.toBe(down);
    expect(deadLetters).toHaveLength(0);
  });

  it("falha ao publicar na DLT: lanca (offset nao pode ser commitado)", async () => {
    const dltDown = new Error("broker indisponivel");
    const failingDeadLetter: Pick<DeadLetterPublisher, "publish" | "ensureTopic"> = {
      publish: async (): Promise<void> => {
        throw dltDown;
      },
      ensureTopic: async (): Promise<void> => undefined,
    };
    const failing = new TestableConsumer(
      {} as Kafka,
      silentLogger,
      new SyncCatalogItemUseCase(repository),
      failingDeadLetter as DeadLetterPublisher,
      config as ConfigService<Env, true>,
    );

    await expect(failing.process(message("{nao json"))).rejects.toBe(dltDown);
  });
});
