-- CreateTable
CREATE TABLE "catalog_items" (
    "itemId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "weightKg" DECIMAL(10,3) NOT NULL,
    "lengthCm" DECIMAL(10,2) NOT NULL,
    "widthCm" DECIMAL(10,2) NOT NULL,
    "heightCm" DECIMAL(10,2) NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "sourceOccurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("eventId")
);

-- CHECK constraints (adicionados a mao; o Prisma nao os modela). Mesmas
-- regras fisicas das colunas equivalentes em items no ms-catalog.
ALTER TABLE "catalog_items"
  ADD CONSTRAINT "catalog_items_weight_kg_positive" CHECK ("weightKg" > 0),
  ADD CONSTRAINT "catalog_items_length_cm_positive" CHECK ("lengthCm" > 0),
  ADD CONSTRAINT "catalog_items_width_cm_positive"  CHECK ("widthCm"  > 0),
  ADD CONSTRAINT "catalog_items_height_cm_positive" CHECK ("heightCm" > 0);
