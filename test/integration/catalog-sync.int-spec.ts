import { execFileSync } from "node:child_process";
import type { INestApplication } from "@nestjs/common";
import { KafkaContainer, type StartedKafkaContainer } from "@testcontainers/kafka";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { PrismaService } from "@infrastructure/database/prisma/prisma.service";
import {
  BOX_001_ID,
  BOX_001_V1,
  CATALOG_TOPIC,
  DLT_TOPIC,
  envelopeV2,
  TOPIC_SEED,
} from "./catalog-topic.fixtures";
import { KafkaTestClient, waitFor } from "./kafka-test-client";

// Sobe Postgres e Kafka reais, aplica as migrations e roda a aplicacao
// (consumer + HTTP) contra eles. Cobre as decisoes 3 a 6: replay da massa,
// idempotencia, protecao contra reordenacao e poison message para a DLT.
describe("ms-transport: sincronizacao do read model (integracao)", () => {
  let postgres: StartedPostgreSqlContainer;
  let kafkaContainer: StartedKafkaContainer;
  let kafka: KafkaTestClient;
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    [postgres, kafkaContainer] = await Promise.all([
      new PostgreSqlContainer("postgres:16-alpine").start(),
      new KafkaContainer("confluentinc/cp-kafka:7.6.1").withKraft().start(),
    ]);
    const broker = `${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(9093)}`;
    kafka = new KafkaTestClient(broker);

    const databaseUrl = postgres.getConnectionUri();
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });

    // Massa publicada antes de a aplicacao subir: o consumer (grupo novo,
    // fromBeginning) reconstroi o read model a partir do historico.
    await kafka.produce(CATALOG_TOPIC, TOPIC_SEED);

    Object.assign(process.env, {
      NODE_ENV: "production",
      LOG_LEVEL: "error",
      DATABASE_URL: databaseUrl,
      KAFKA_BROKER: broker,
      CONSUMER_RETRY_RETRIES: "2",
      CONSUMER_RETRY_INITIAL_MS: "100",
    });

    // Import depois do env: o ConfigModule valida as variaveis ao carregar.
    const { NestFactory } = await import("@nestjs/core");
    const { AppModule } = await import("../../src/app.module");
    const { PrismaService: PrismaServiceToken } = await import(
      "@infrastructure/database/prisma/prisma.service"
    );

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace("[::1]", "localhost");
    prisma = app.get(PrismaServiceToken);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), kafkaContainer?.stop()]);
  });

  const countItems = (): Promise<number> => prisma.catalogItem.count();
  const countProcessed = (): Promise<number> => prisma.processedEvent.count();

  it("replay da massa: 1 item no read model e 3 mensagens na DLT", async () => {
    await waitFor("BOX-001 no read model", async () => (await countItems()) === 1);

    const deadLetters = await kafka.readFromBeginning(DLT_TOPIC, 3, 30_000);
    expect(deadLetters.map((m) => m.headers["dlt-reason"])).toEqual([
      "unsupported_schema_version",
      "unsupported_schema_version",
      "invalid_json",
    ]);
    // Payload original intacto e origem nos headers.
    expect(deadLetters[2]?.value).toBe("{isto nao e json");
    expect(deadLetters[2]?.headers).toMatchObject({
      "dlt-source-topic": CATALOG_TOPIC,
      "dlt-source-partition": "0",
      "dlt-source-offset": "2",
    });

    const item = await prisma.catalogItem.findUniqueOrThrow({ where: { itemId: BOX_001_ID } });
    expect(item.sku).toBe("BOX-001");
    expect(item.weightKg.toNumber()).toBe(0.75);
    expect(item.lengthCm.toNumber()).toBe(40);
  });

  it("GET /catalog-items/:itemId devolve o item do read model", async () => {
    const response = await fetch(`${baseUrl}/catalog-items/${BOX_001_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      itemId: BOX_001_ID,
      sku: "BOX-001",
      weightKg: 0.75,
      dimensions: { lengthCm: 40, widthCm: 30, heightCm: 25 },
    });
  });

  it("reenviar o mesmo evento nao duplica nem altera o registro", async () => {
    const before = await prisma.catalogItem.findUniqueOrThrow({ where: { itemId: BOX_001_ID } });
    const processedBefore = await countProcessed();

    await kafka.produce(CATALOG_TOPIC, [BOX_001_V1]);
    // Um evento novo depois do reenvio serve de marcador: quando ele for
    // processado, o reenvio (offset anterior, mesma particao) ja foi.
    const marker = envelopeV2({ itemId: "11111111-1111-4111-8111-000000000001", sku: "MARKER-1", occurredAt: "2026-09-10T00:00:00.000Z", weightKg: 1 });
    await kafka.produce(CATALOG_TOPIC, [marker]);
    await waitFor("marcador processado", async () => (await countItems()) === 2);

    const after = await prisma.catalogItem.findUniqueOrThrow({ where: { itemId: BOX_001_ID } });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.sourceEventId).toBe(before.sourceEventId);
    // So o marcador entrou em processed_events.
    expect(await countProcessed()).toBe(processedBefore + 1);
  });

  it("evento mais antigo que o gravado nao sobrescreve (reordenacao)", async () => {
    const itemId = "22222222-2222-4222-8222-000000000002";
    const newer = envelopeV2({ itemId, sku: "ORDER-1", occurredAt: "2026-09-20T00:00:00.000Z", weightKg: 2 });
    const older = envelopeV2({ itemId, sku: "ORDER-1", occurredAt: "2026-09-19T00:00:00.000Z", weightKg: 9 });

    const processedBefore = await countProcessed();
    await kafka.produce(CATALOG_TOPIC, [newer, older]);
    // Os dois entram em processed_events (o mais antigo como "stale").
    await waitFor("dois eventos processados", async () => (await countProcessed()) === processedBefore + 2);

    const item = await prisma.catalogItem.findUniqueOrThrow({ where: { itemId } });
    expect(item.weightKg.toNumber()).toBe(2);
    expect(item.sourceOccurredAt.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("violacao de invariante do dominio vai para a DLT e o consumo segue", async () => {
    const poison = envelopeV2({ itemId: "33333333-3333-4333-8333-000000000003", sku: "POISON-1", occurredAt: "2026-09-21T00:00:00.000Z", weightKg: 0 });
    const next = envelopeV2({ itemId: "44444444-4444-4444-8444-000000000004", sku: "NEXT-1", occurredAt: "2026-09-21T00:00:01.000Z", weightKg: 3 });

    await kafka.produce(CATALOG_TOPIC, [poison, next]);
    await waitFor("evento seguinte processado", async () =>
      (await prisma.catalogItem.count({ where: { itemId: "44444444-4444-4444-8444-000000000004" } })) === 1,
    );

    const deadLetters = await kafka.readFromBeginning(DLT_TOPIC, 4, 30_000);
    expect(deadLetters).toHaveLength(4);
    expect(deadLetters[3]?.headers["dlt-reason"]).toBe("domain_invariant_violation");
    expect(deadLetters[3]?.value).toBe(poison.value);
    expect(await prisma.catalogItem.count({ where: { itemId: "33333333-3333-4333-8333-000000000003" } })).toBe(0);
  });
});
