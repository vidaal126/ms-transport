import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

async function main() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  const transportTypes = [
    { name: "Caminhão", dailyCapacity: 10 },
    { name: "Moto", dailyCapacity: 30 },
    { name: "Van", dailyCapacity: 15 },
  ];

  for (const data of transportTypes) {
    await prisma.transportType.upsert({
      where: { name: data.name },
      create: data,
      update: {},
    });
  }

  console.log(`Seed concluído: ${transportTypes.length} tipos de transporte.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Erro no seed:", err);
  process.exit(1);
});
