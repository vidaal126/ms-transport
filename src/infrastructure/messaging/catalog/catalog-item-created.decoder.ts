import { createHash } from "node:crypto";
import { z } from "zod";
import type { CatalogItemEvent } from "@application/use-cases/sync-catalog-item.use-case";
import type { DeadLetterReason } from "@infrastructure/messaging/dead-letter.publisher";

export const ITEM_CREATED_EVENT_TYPE = "ItemCreated";
const SUPPORTED_ENVELOPE_VERSION = 2;
const SUPPORTED_LEGACY_VERSION = 1;

const payloadSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  weightKg: z.number(),
  dimensions: z.object({
    lengthCm: z.number(),
    widthCm: z.number(),
    heightCm: z.number(),
  }),
});

// v2: envelope com schemaVersion no topo (ms-catalog atual).
const envelopeV2Schema = z.object({
  eventId: z.uuid(),
  eventType: z.literal(ITEM_CREATED_EVENT_TYPE),
  schemaVersion: z.number().int(),
  occurredAt: z.iso.datetime(),
  aggregateId: z.string().min(1),
  correlationId: z.string().min(1),
  payload: z.unknown(),
});

// v1 e anteriores: envelope sem eventId/schemaVersion; versao (quando
// existe) vai dentro do payload.
const legacyEnvelopeSchema = z.object({
  eventType: z.literal(ITEM_CREATED_EVENT_TYPE),
  aggregateId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()),
});

const hasTopLevelVersionSchema = z.object({ schemaVersion: z.number() });
const legacyPayloadVersionSchema = z.object({ schemaVersion: z.number().int() });

export type DecodeResult =
  | {
      readonly ok: true;
      readonly event: CatalogItemEvent;
      // Presente no envelope v2; v1 nao carrega correlationId.
      readonly correlationId?: string;
    }
  | { readonly ok: false; readonly reason: DeadLetterReason; readonly detail: string };

// Aceita os dois formatos durante a migracao expand/contract:
// - envelope v2 (schemaVersion no topo);
// - v1 antigo (schemaVersion 1 dentro do payload).
// Eventos legados sem schemaVersion nao tem peso/dimensoes e nao ha dado
// para um upcaster reconstruir: unsupported_schema_version (limitacao
// conhecida).
export function decodeCatalogItemCreated(raw: Buffer | null): DecodeResult {
  if (raw === null || raw.length === 0) {
    return fail("invalid_json", "mensagem vazia");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    return fail("invalid_json", err instanceof Error ? err.message : "JSON invalido");
  }

  return hasTopLevelVersionSchema.safeParse(parsed).success
    ? decodeEnvelopeV2(parsed)
    : decodeLegacy(parsed);
}

function decodeEnvelopeV2(parsed: unknown): DecodeResult {
  const envelope = envelopeV2Schema.safeParse(parsed);
  if (!envelope.success) return schemaFailure(envelope.error);

  const { schemaVersion } = envelope.data;
  if (schemaVersion !== SUPPORTED_ENVELOPE_VERSION) {
    return fail("unsupported_schema_version", `schemaVersion ${schemaVersion} no envelope`);
  }

  const payload = payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) return schemaFailure(payload.error);

  const decoded = toEvent(envelope.data.eventId, envelope.data, payload.data);
  return decoded.ok
    ? { ...decoded, correlationId: envelope.data.correlationId }
    : decoded;
}

function decodeLegacy(parsed: unknown): DecodeResult {
  const envelope = legacyEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) return schemaFailure(envelope.error);

  const version = legacyPayloadVersionSchema.safeParse(envelope.data.payload);
  if (!version.success) {
    return fail(
      "unsupported_schema_version",
      "evento legado sem schemaVersion (sem peso e dimensoes)",
    );
  }
  if (version.data.schemaVersion !== SUPPORTED_LEGACY_VERSION) {
    return fail(
      "unsupported_schema_version",
      `schemaVersion ${version.data.schemaVersion} no payload`,
    );
  }

  const payload = payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) return schemaFailure(payload.error);

  return toEvent(legacyEventId(envelope.data), envelope.data, payload.data);
}

// v1 nao tem eventId: deriva um id deterministico do conteudo que identifica
// o evento, estavel entre republicacoes do outbox e reenvios manuais.
export function legacyEventId(envelope: {
  readonly eventType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
}): string {
  const digest = createHash("sha256")
    .update(`${envelope.eventType}|${envelope.aggregateId}|${envelope.occurredAt}`)
    .digest("hex");
  return `v1:${digest}`;
}

function toEvent(
  eventId: string,
  envelope: { readonly eventType: string; readonly aggregateId: string; readonly occurredAt: string },
  payload: z.infer<typeof payloadSchema>,
): DecodeResult {
  if (payload.id !== envelope.aggregateId) {
    return fail(
      "schema_validation_failed",
      `aggregateId ${envelope.aggregateId} difere de payload.id ${payload.id}`,
    );
  }

  return {
    ok: true,
    event: {
      eventId,
      eventType: envelope.eventType,
      occurredAt: new Date(envelope.occurredAt),
      itemId: payload.id,
      sku: payload.sku,
      weightKg: payload.weightKg,
      dimensions: payload.dimensions,
    },
  };
}

function schemaFailure(error: z.ZodError): DecodeResult {
  return fail("schema_validation_failed", z.prettifyError(error));
}

function fail(reason: DeadLetterReason, detail: string): DecodeResult {
  return { ok: false, reason, detail };
}
