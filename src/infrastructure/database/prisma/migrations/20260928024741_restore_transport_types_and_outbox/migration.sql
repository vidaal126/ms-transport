-- CreateTable
CREATE TABLE "transport_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_types_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "transport_types_name_key" ON "transport_types"("name");

-- CreateIndex
CREATE INDEX "transport_types_createdAt_id_idx" ON "transport_types"("createdAt", "id");

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_createdAt_idx" ON "outbox_events"("publishedAt", "createdAt");

-- Prisma nao modela CHECK constraints: escritas a mao. Mesmos limites do
-- dominio (TransportType): nome 1..100 sem espacos nas pontas, descricao
-- ate 500 e nunca vazia (vazia vira NULL no dominio).
ALTER TABLE "transport_types"
  ADD CONSTRAINT "transport_types_name_length" CHECK (char_length("name") BETWEEN 1 AND 100 AND "name" = btrim("name")),
  ADD CONSTRAINT "transport_types_description_length" CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 500),
  ADD CONSTRAINT "transport_types_updated_after_created" CHECK ("updatedAt" >= "createdAt");

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_schema_version_positive" CHECK ("schemaVersion" > 0);
