/*
  Warnings:

  - You are about to drop the column `dailyCapacity` on the `transport_types` table. All the data in the column will be lost.
  - You are about to drop the column `usedToday` on the `transport_types` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "transport_types" DROP COLUMN "dailyCapacity",
DROP COLUMN "usedToday",
ADD COLUMN     "description" TEXT,
ALTER COLUMN "createdAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_createdAt_idx" ON "outbox_events"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "transport_types_createdAt_id_idx" ON "transport_types"("createdAt", "id");

-- Linhas herdadas do init: @updatedAt era preenchido pelo cliente antes do
-- DEFAULT do createdAt no banco, entao updatedAt pode ficar alguns ms antes.
-- Normaliza antes do CHECK para nao falhar em bancos ja populados.
UPDATE "transport_types" SET "updatedAt" = "createdAt" WHERE "updatedAt" < "createdAt";

-- Prisma nao modela CHECK constraints: escritas a mao. Mesmos limites do
-- dominio (TransportType): nome 1..100 sem espacos nas pontas, descricao
-- ate 500 e nunca vazia (vazia vira NULL no dominio).
ALTER TABLE "transport_types"
  ADD CONSTRAINT "transport_types_name_length" CHECK (char_length("name") BETWEEN 1 AND 100 AND "name" = btrim("name")),
  ADD CONSTRAINT "transport_types_description_length" CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 500),
  ADD CONSTRAINT "transport_types_updated_after_created" CHECK ("updatedAt" >= "createdAt");

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_schema_version_positive" CHECK ("schemaVersion" > 0);

-- Backfill: um TransportTypeCreated por tipo ja existente, no mesmo formato
-- que toOutboxEventData grava (envelope v2, payload = snapshot do agregado),
-- para que as replicas do ms-customer e do ms-sales-order recebam os tipos
-- anteriores ao outbox. occurredAt = updatedAt: instante do estado publicado.
INSERT INTO "outbox_events" ("id", "aggregateId", "eventType", "schemaVersion", "correlationId", "payload", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  'TransportTypeCreated',
  2,
  'migration-backfill',
  jsonb_build_object('id', "id", 'name', "name", 'description', "description", 'active', "active"),
  "updatedAt"
FROM "transport_types"
ORDER BY "createdAt", "id";
