import { ConfigService } from "@nestjs/config";
import type { ILogger } from "@common/logger/logger.interface";
import type { Env } from "@config/env";
import type { OutboxEvent } from "@infrastructure/database/generated/client";
import type { OutboundMessage } from "@infrastructure/messaging/event-envelope";
import type { KafkaProducerService } from "@infrastructure/messaging/kafka-producer.service";
import { MetricsService } from "@infrastructure/metrics/metrics.service";
import { OutboxPublisherService } from "./outbox-publisher.service";
import type { OutboxRepository } from "./outbox.repository";

const POLL_INTERVAL_MS = 1_000;
const AGGREGATE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGGREGATE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let nextSequence = 1n;

function outboxEvent(id: string, aggregateId: string): OutboxEvent {
  return {
    id,
    sequence: nextSequence++,
    aggregateId,
    eventType: "TransportTypeUpdated",
    schemaVersion: 2,
    correlationId: "corr-1",
    payload: { id: aggregateId },
    createdAt: new Date("2026-09-28T12:00:00.000Z"),
    publishedAt: null,
  };
}

function eventIdOf(message: OutboundMessage): string {
  const envelope = JSON.parse(String(message.value)) as { eventId: string };
  return envelope.eventId;
}

describe("OutboxPublisherService", () => {
  let pending: OutboxEvent[];
  let failingEventIds: Set<string>;
  let sentEventIds: string[];
  let markPublished: jest.Mock<Promise<void>, [readonly string[], Date]>;
  let logger: ILogger;
  let createService: () => OutboxPublisherService;

  beforeEach(() => {
    jest.useFakeTimers();
    pending = [];
    failingEventIds = new Set();
    sentEventIds = [];
    markPublished = jest.fn(async (_ids: readonly string[], _at: Date): Promise<void> => undefined);
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    const outbox = {
      findPending: jest.fn(async () => pending),
      countPending: jest.fn(async () => pending.length),
      markPublished,
    } as unknown as OutboxRepository;
    const producer = {
      send: jest.fn(async (message: OutboundMessage) => {
        const eventId = eventIdOf(message);
        if (failingEventIds.has(eventId)) throw new Error("broker indisponivel");
        sentEventIds.push(eventId);
      }),
    } as unknown as KafkaProducerService;
    const config = new ConfigService<Env, true>({
      OUTBOX_POLL_INTERVAL_MS: POLL_INTERVAL_MS,
      OUTBOX_BATCH_SIZE: 20,
    });

    createService = () =>
      new OutboxPublisherService(outbox, producer, logger, new MetricsService(), config);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Roda exatamente um ciclo e espera ele terminar (onModuleDestroy aguarda o
  // ciclo em andamento). O estado entre ciclos vive so no outbox.
  const runOneCycle = async (): Promise<void> => {
    const service = createService();
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await service.onModuleDestroy();
  };

  it("publica na ordem de sequence e marca todos os enviados", async () => {
    pending = [outboxEvent("a1", AGGREGATE_A), outboxEvent("b1", AGGREGATE_B), outboxEvent("a2", AGGREGATE_A)];

    await runOneCycle();

    expect(sentEventIds).toEqual(["a1", "b1", "a2"]);
    expect(markPublished).toHaveBeenCalledWith(["a1", "b1", "a2"], expect.any(Date));
  });

  it("falha no envio bloqueia o resto do agregado no ciclo; outros agregados seguem", async () => {
    pending = [
      outboxEvent("a1", AGGREGATE_A),
      outboxEvent("b1", AGGREGATE_B),
      outboxEvent("a2", AGGREGATE_A),
      outboxEvent("b2", AGGREGATE_B),
    ];
    failingEventIds.add("a1");

    await runOneCycle();

    // a2 nao pode sair antes de a1: fica para o proximo tick.
    expect(sentEventIds).toEqual(["b1", "b2"]);
    expect(markPublished).toHaveBeenCalledWith(["b1", "b2"], expect.any(Date));
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(AGGREGATE_A), expect.any(Error));
  });

  it("o bloqueio vale so para o ciclo: o proximo tick tenta de novo em ordem", async () => {
    pending = [outboxEvent("a1", AGGREGATE_A), outboxEvent("a2", AGGREGATE_A)];
    failingEventIds.add("a1");
    await runOneCycle();
    expect(sentEventIds).toEqual([]);
    expect(markPublished).not.toHaveBeenCalled();

    failingEventIds.clear();
    await runOneCycle();

    expect(sentEventIds).toEqual(["a1", "a2"]);
    expect(markPublished).toHaveBeenCalledWith(["a1", "a2"], expect.any(Date));
  });
});
