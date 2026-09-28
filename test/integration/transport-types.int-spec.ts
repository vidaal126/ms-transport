import { execFileSync } from "node:child_process";
import { KafkaContainer, type StartedKafkaContainer } from "@testcontainers/kafka";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { z } from "zod";
import {
  type ITransportTypeRepository,
  TRANSPORT_TYPE_REPOSITORY,
} from "@application/ports/transport-type.repository.port";
import { TransportTypeConcurrentModificationError } from "@domain/errors/transport-type.errors";
import type { PrismaService } from "@infrastructure/database/prisma/prisma.service";
import { sampleValue } from "../../src/test/metrics.helpers";
import { KafkaTestClient, waitFor } from "./kafka-test-client";

const CREATED_TOPIC = "transport.TransportTypeCreated";
const UPDATED_TOPIC = "transport.TransportTypeUpdated";

const transportTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const envelopeSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string(),
  schemaVersion: z.literal(2),
  occurredAt: z.iso.datetime(),
  aggregateId: z.uuid(),
  correlationId: z.string(),
  payload: z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    active: z.boolean(),
  }),
});

interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

async function send(
  method: "POST" | "PUT" | "GET",
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// Dono do tipo de transporte: HTTP -> transacao (tabela + outbox) -> Kafka.
describe("ms-transport: tipos de transporte (integracao)", () => {
  let postgres: StartedPostgreSqlContainer;
  let kafkaContainer: StartedKafkaContainer;
  let kafka: KafkaTestClient;
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    [postgres, kafkaContainer] = await Promise.all([
      new PostgreSqlContainer("postgres:16-alpine").start(),
      new KafkaContainer("confluentinc/cp-kafka:7.6.1")
        .withKraft()
        .withEnvironment({ KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false" })
        .start(),
    ]);
    const broker = `${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(9093)}`;
    kafka = new KafkaTestClient(broker);
    await Promise.all(
      ["catalog.ItemCreated", CREATED_TOPIC, UPDATED_TOPIC].map((topic) => kafka.createTopic(topic)),
    );

    const databaseUrl = postgres.getConnectionUri();
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });

    Object.assign(process.env, {
      NODE_ENV: "production",
      LOG_LEVEL: "error",
      DATABASE_URL: databaseUrl,
      KAFKA_BROKER: broker,
      OUTBOX_POLL_INTERVAL_MS: "200",
      THROTTLE_DEFAULT_LIMIT: "100",
    });

    const { NestFactory } = await import("@nestjs/core");
    const { AppModule } = await import("../../src/app.module");
    const { configureApp } = await import("../../src/app.setup");

    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace("[::1]", "localhost");
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), kafkaContainer?.stop()]);
  });

  let createdId = "";

  it("POST cria o tipo e publica TransportTypeCreated com envelope v2, key e headers", async () => {
    const created = await send(
      "POST",
      `${baseUrl}/transport-types`,
      { name: "Caminhao bau", description: "Carga seca" },
      { "x-correlation-id": "tt-corr-1" },
    );

    expect(created.status).toBe(201);
    const body = transportTypeSchema.parse(created.body);
    createdId = body.id;
    expect(body).toMatchObject({ name: "Caminhao bau", active: true });

    const [message] = await kafka.readFromBeginning(CREATED_TOPIC, 1, 30_000);
    expect(message?.key).toBe(body.id);
    expect(message?.headers).toEqual({
      eventType: "TransportTypeCreated",
      schemaVersion: "2",
      correlationId: "tt-corr-1",
    });
    const envelope = envelopeSchema.parse(JSON.parse(message?.value ?? ""));
    expect(envelope).toMatchObject({
      aggregateId: body.id,
      payload: { id: body.id, name: "Caminhao bau", description: "Carga seca", active: true },
    });
  });

  it("nome duplicado retorna 409", async () => {
    const duplicate = await send("POST", `${baseUrl}/transport-types`, { name: "Caminhao bau" });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ error: "TransportTypeNameAlreadyExistsError" });
  });

  it("corpo invalido retorna 400; name null no PUT tambem", async () => {
    const invalid = await send("POST", `${baseUrl}/transport-types`, { name: "", extra: 1 });
    const nullName = await send("PUT", `${baseUrl}/transport-types/${createdId}`, { name: null });

    expect(invalid.status).toBe(400);
    expect(nullName.status).toBe(400);
  });

  it("PUT com mudanca publica TransportTypeUpdated; sem mudanca nao publica", async () => {
    const updated = await send("PUT", `${baseUrl}/transport-types/${createdId}`, { active: false });
    const unchanged = await send("PUT", `${baseUrl}/transport-types/${createdId}`, { active: false });

    expect(updated.status).toBe(200);
    expect(unchanged.status).toBe(200);
    expect(transportTypeSchema.parse(updated.body).active).toBe(false);

    const messages = await kafka.readFromBeginning(UPDATED_TOPIC, 2, 8_000);
    expect(messages).toHaveLength(1);
    const envelope = envelopeSchema.parse(JSON.parse(messages[0]?.value ?? ""));
    expect(envelope.payload).toMatchObject({ id: createdId, active: false });
  });

  it("update concorrente com versao antiga falha com conflito (409) sem gravar nem publicar", async () => {
    const { PrismaService: PrismaServiceToken } = await import(
      "@infrastructure/database/prisma/prisma.service"
    );
    const prisma = app.get<PrismaService>(PrismaServiceToken);
    const repository = app.get<ITransportTypeRepository>(TRANSPORT_TYPE_REPOSITORY);
    const context = { correlationId: "tt-conflict" };
    const countUpdates = (): Promise<number> =>
      prisma.outboxEvent.count({
        where: { aggregateId: createdId, eventType: "TransportTypeUpdated" },
      });

    // Duas requisicoes leem a mesma versao; a primeira grava antes.
    const first = await repository.findById(createdId);
    const second = await repository.findById(createdId);
    if (!first || !second) throw new Error("tipo criado nao encontrado");
    const updatesBefore = await countUpdates();

    first.update({ description: "Primeira", now: new Date() });
    await repository.update(first, context);
    second.update({ description: "Segunda", now: new Date() });

    await expect(repository.update(second, context)).rejects.toBeInstanceOf(
      TransportTypeConcurrentModificationError,
    );
    const stored = await prisma.transportType.findUniqueOrThrow({ where: { id: createdId } });
    expect(stored).toMatchObject({ description: "Primeira", version: second.version + 1 });
    expect(await countUpdates()).toBe(updatesBefore + 1);
  });

  it("GET por id, 404 para inexistente e listagem paginada com total", async () => {
    const found = await send("GET", `${baseUrl}/transport-types/${createdId}`);
    const missing = await send(
      "GET",
      `${baseUrl}/transport-types/00000000-0000-4000-8000-000000000000`,
    );
    const page = await send("GET", `${baseUrl}/transport-types?page=1&limit=10`);

    expect(found.status).toBe(200);
    expect(missing.status).toBe(404);
    expect(page.body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
  });

  it("GET /metrics expoe latencia por template de rota e eventos publicados", async () => {
    const scrape = async (): Promise<string> => (await fetch(`${baseUrl}/metrics`)).text();
    // O publisher marca publishedAt depois de enviar o lote: espera o ciclo fechar.
    await waitFor("outbox drenado", async () => sampleValue(await scrape(), "outbox_pending_events", {}) === 0);
    const response = await fetch(`${baseUrl}/metrics`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(
      sampleValue(text, "http_request_duration_seconds_count", {
        method: "GET",
        route: "/transport-types/:id",
        status_code: "200",
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(sampleValue(text, "outbox_events_published_total", { event_type: "TransportTypeCreated" })).toBe(1);
    expect(sampleValue(text, "outbox_pending_events", {})).toBe(0);
  });

  // Roda por ultimo: esgota o balde de um cliente.
  it("throttler conta por cliente (X-Forwarded-For do gateway), nao pelo proxy", async () => {
    const listFrom = async (clientIp: string): Promise<number> => {
      const response = await fetch(`${baseUrl}/transport-types?page=1&limit=1`, {
        headers: { "x-forwarded-for": clientIp },
      });
      await response.text();
      return response.status;
    };
    const limit = Number(process.env.THROTTLE_DEFAULT_LIMIT);

    for (let attempt = 0; attempt < limit; attempt++) {
      expect(await listFrom("203.0.113.10")).toBe(200);
    }
    expect(await listFrom("203.0.113.10")).toBe(429);
    expect(await listFrom("203.0.113.20")).toBe(200);
  });
});
