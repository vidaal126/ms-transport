import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import type { DeadLetterReason } from "@application/ports/dead-letter.port";
import type { CatalogItemEvent } from "@application/ports/sync-catalog-item.port";

export const ITEM_CREATED_EVENT_TYPE = "ItemCreated";
const SUPPORTED_ENVELOPE_VERSION = 2;
const SUPPORTED_LEGACY_VERSION = 1;

// Namespace fixo do ms-transport para derivar eventIds de eventos v1. Nunca
// mudar: mudaria o id de todos os eventos legados ja processados.
export const LEGACY_EVENT_ID_NAMESPACE = "0b7c5f2e-4a51-4d0c-9e7a-3f1d8c6b2a90";

// Posicao da mensagem no Kafka: identifica um evento v1, que nao tem eventId.
export interface MessagePosition {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
}

const payloadSchema = z.object({
  // O ms-catalog sempre gerou UUID; o GET /catalog-items/:itemId so aceita UUID.
  id: z.uuid(),
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
export function decodeCatalogItemCreated(
  raw: Buffer | null,
  position: MessagePosition,
): DecodeResult {
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
    : decodeLegacy(parsed, position);
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

function decodeLegacy(parsed: unknown, position: MessagePosition): DecodeResult {
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

  return toEvent(legacyEventId(position), envelope.data, payload.data);
}

// v1 nao tem eventId: UUID v5 sobre topico+particao+offset. Deterministico
// para a mesma mensagem (replay e seguro), mas o mesmo evento republicado em
// outro offset ganha outro id; nesse caso a protecao e o guard de
// sourceOccurredAt no upsert (limitacao documentada).
export function legacyEventId(position: MessagePosition): string {
  return uuidv5(
    `${position.topic}:${position.partition}:${position.offset}`,
    LEGACY_EVENT_ID_NAMESPACE,
  );
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
