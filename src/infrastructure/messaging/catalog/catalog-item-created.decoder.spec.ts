import { decodeCatalogItemCreated, legacyEventId } from "./catalog-item-created.decoder";

const BOX_001_ID = "b8a91f43-8755-4815-bd61-bb3b15760af0";

const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

// Mensagens da massa do topico (scripts/seed-catalog-topic.mts no ms-catalog).
const legacyStringPrice = encode({
  eventType: "ItemCreated",
  aggregateId: "5b0c3a52-0d6f-4c8e-9c1a-000000000001",
  payload: {
    id: "5b0c3a52-0d6f-4c8e-9c1a-000000000001",
    sku: "LEGACY-001",
    name: "Item legado (unitPrice string)",
    unitPrice: "19.90",
  },
  occurredAt: "2026-08-25T12:00:00.000Z",
});

const legacyNumberPrice = encode({
  eventType: "ItemCreated",
  aggregateId: "5b0c3a52-0d6f-4c8e-9c1a-000000000002",
  payload: {
    id: "5b0c3a52-0d6f-4c8e-9c1a-000000000002",
    sku: "LEGACY-002",
    name: "Item legado (unitPrice numero)",
    unitPrice: 29.9,
  },
  occurredAt: "2026-09-01T12:00:00.000Z",
});

const invalidJson = Buffer.from("{isto nao e json");

const v1Box001 = {
  eventType: "ItemCreated",
  aggregateId: BOX_001_ID,
  payload: {
    schemaVersion: 1,
    id: BOX_001_ID,
    sku: "BOX-001",
    name: "Caixa Média",
    unitPrice: 24.9,
    weightKg: 0.75,
    dimensions: { lengthCm: 40, widthCm: 30, heightCm: 25 },
  },
  occurredAt: "2026-09-03T01:56:10.122Z",
};

// Formato publicado hoje pelo outbox do ms-catalog.
const v2 = {
  eventId: "36e7f1e7-d189-480c-a72f-09a5fe4093c0",
  eventType: "ItemCreated",
  schemaVersion: 2,
  occurredAt: "2026-09-22T22:56:51.873Z",
  aggregateId: "2c58065b-1001-48c7-924e-70b1436a27e0",
  correlationId: "smoke-corr-1",
  payload: {
    id: "2c58065b-1001-48c7-924e-70b1436a27e0",
    sku: "SMOKE-1",
    name: "Caixa smoke",
    weightKg: 1.25,
    unitPrice: 12.5,
    dimensions: { widthCm: 20, heightCm: 10.5, lengthCm: 30 },
  },
};

describe("decodeCatalogItemCreated", () => {
  describe("massa do topico", () => {
    it.each([
      ["legado com unitPrice string", legacyStringPrice],
      ["legado com unitPrice numero", legacyNumberPrice],
    ])("%s -> unsupported_schema_version", (_label, raw) => {
      expect(decodeCatalogItemCreated(raw)).toMatchObject({
        ok: false,
        reason: "unsupported_schema_version",
      });
    });

    it("mensagem que nao e JSON -> invalid_json", () => {
      expect(decodeCatalogItemCreated(invalidJson)).toMatchObject({
        ok: false,
        reason: "invalid_json",
      });
    });

    it("v1 BOX-001 -> evento normalizado com eventId deterministico", () => {
      const result = decodeCatalogItemCreated(encode(v1Box001));

      expect(result).toEqual({
        ok: true,
        event: {
          eventId: legacyEventId(v1Box001),
          eventType: "ItemCreated",
          occurredAt: new Date("2026-09-03T01:56:10.122Z"),
          itemId: BOX_001_ID,
          sku: "BOX-001",
          weightKg: 0.75,
          dimensions: { lengthCm: 40, widthCm: 30, heightCm: 25 },
        },
      });
    });
  });

  it("reenvio do mesmo v1 gera o mesmo eventId", () => {
    const first = decodeCatalogItemCreated(encode(v1Box001));
    const again = decodeCatalogItemCreated(encode({ ...v1Box001 }));

    expect(first.ok && again.ok && first.event.eventId === again.event.eventId).toBe(true);
  });

  it("envelope v2 -> usa o eventId do envelope", () => {
    const result = decodeCatalogItemCreated(encode(v2));

    expect(result).toMatchObject({
      ok: true,
      correlationId: "smoke-corr-1",
      event: { eventId: v2.eventId, itemId: v2.aggregateId, weightKg: 1.25 },
    });
  });

  it.each([
    ["envelope v3", { ...v2, schemaVersion: 3 }, "unsupported_schema_version"],
    ["v1 com schemaVersion 9 no payload", { ...v1Box001, payload: { ...v1Box001.payload, schemaVersion: 9 } }, "unsupported_schema_version"],
    ["v2 sem dimensions", { ...v2, payload: { ...v2.payload, dimensions: undefined } }, "schema_validation_failed"],
    ["v2 com eventId que nao e uuid", { ...v2, eventId: "abc" }, "schema_validation_failed"],
    ["v1 com weightKg string", { ...v1Box001, payload: { ...v1Box001.payload, weightKg: "0.75" } }, "schema_validation_failed"],
    ["aggregateId diferente de payload.id", { ...v2, aggregateId: "outro" }, "schema_validation_failed"],
    ["outro eventType", { ...v2, eventType: "ItemDeleted" }, "schema_validation_failed"],
    ["JSON que nao e objeto", 42, "schema_validation_failed"],
  ])("%s -> %s", (_label, message, reason) => {
    expect(decodeCatalogItemCreated(encode(message))).toMatchObject({ ok: false, reason });
  });

  it("mensagem nula (tombstone) -> invalid_json", () => {
    expect(decodeCatalogItemCreated(null)).toMatchObject({ ok: false, reason: "invalid_json" });
  });
});
