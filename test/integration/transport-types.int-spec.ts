import { execFileSync } from "node:child_process";
import type { INestApplication } from "@nestjs/common";
import { KafkaContainer, type StartedKafkaContainer } from "@testcontainers/kafka";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { z } from "zod";
import { sampleValue } from "../../src/test/metrics.helpers";
import { KafkaTestClient } from "./kafka-test-client";

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
  let app: INestApplication;
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
    });

    const { NestFactory } = await import("@nestjs/core");
    const { AppModule } = await import("../../src/app.module");
    const { configureApp } = await import("../../src/app.setup");

    app = await NestFactory.create(AppModule, { logger: false });
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
});
