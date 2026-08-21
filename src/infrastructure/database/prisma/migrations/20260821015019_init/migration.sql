-- CreateTable
CREATE TABLE "transport_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dailyCapacity" INTEGER NOT NULL,
    "usedToday" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transport_types_name_key" ON "transport_types"("name");
