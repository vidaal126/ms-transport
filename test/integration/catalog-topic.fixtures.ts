import { randomUUID } from "node:crypto";
import type { ProducedMessage } from "./kafka-test-client";

export const CATALOG_TOPIC = "catalog.ItemCreated";
export const DLT_TOPIC = "catalog.ItemCreated.DLT";
export const BOX_001_ID = "b8a91f43-8755-4815-bd61-bb3b15760af0";

const json = (value: unknown): string => JSON.stringify(value);

// Mesma massa do scripts/seed-catalog-topic.mts do ms-catalog: 2 eventos
// legados, 1 mensagem invalida e o BOX-001 em v1.
export const LEGACY_STRING_PRICE: ProducedMessage = {
  key: "5b0c3a52-0d6f-4c8e-9c1a-000000000001",
  value: json({
    eventType: "ItemCreated",
    aggregateId: "5b0c3a52-0d6f-4c8e-9c1a-000000000001",
    payload: { id: "5b0c3a52-0d6f-4c8e-9c1a-000000000001", sku: "LEGACY-001", name: "Item legado (unitPrice string)", unitPrice: "19.90" },
    occurredAt: "2026-08-25T12:00:00.000Z",
  }),
};

export const LEGACY_NUMBER_PRICE: ProducedMessage = {
  key: "5b0c3a52-0d6f-4c8e-9c1a-000000000002",
  value: json({
    eventType: "ItemCreated",
    aggregateId: "5b0c3a52-0d6f-4c8e-9c1a-000000000002",
    payload: { id: "5b0c3a52-0d6f-4c8e-9c1a-000000000002", sku: "LEGACY-002", name: "Item legado (unitPrice numero)", unitPrice: 29.9 },
    occurredAt: "2026-09-01T12:00:00.000Z",
  }),
};

export const INVALID_JSON: ProducedMessage = { key: "invalid-message", value: "{isto nao e json" };

export const BOX_001_V1: ProducedMessage = {
  key: BOX_001_ID,
  value: json({
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
  }),
};

export const TOPIC_SEED: readonly ProducedMessage[] = [
  LEGACY_STRING_PRICE,
  LEGACY_NUMBER_PRICE,
  INVALID_JSON,
  BOX_001_V1,
];

export function envelopeV2(input: {
  readonly itemId: string;
  readonly occurredAt: string;
  readonly weightKg: number;
  readonly sku?: string;
}): ProducedMessage {
  const eventId = randomUUID();
  const correlationId = `it-${eventId}`;
  return {
    key: input.itemId,
    headers: { eventType: "ItemCreated", schemaVersion: "2", correlationId },
    value: json({
      eventId,
      eventType: "ItemCreated",
      schemaVersion: 2,
      occurredAt: input.occurredAt,
      aggregateId: input.itemId,
      correlationId,
      payload: {
        id: input.itemId,
        sku: input.sku ?? "BOX-001",
        name: "Caixa",
        unitPrice: 24.9,
        weightKg: input.weightKg,
        dimensions: { lengthCm: 40, widthCm: 30, heightCm: 25 },
      },
    }),
  };
}
