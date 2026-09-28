import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type TransportType as TransportTypeModel,
} from "@infrastructure/database/generated/client";
import { TransportType } from "@domain/entities/transport-type.entity";
import {
  TransportTypeConcurrentModificationError,
  TransportTypeNameAlreadyExistsError,
} from "@domain/errors/transport-type.errors";
import type {
  ITransportTypeRepository,
  Page,
  PageRequest,
  PersistenceContext,
} from "@application/ports/transport-type.repository.port";
import { toOutboxEventData } from "@infrastructure/database/mappers/outbox-event.mapper";
import { PrismaService } from "@infrastructure/database/prisma/prisma.service";

@Injectable()
export class TransportTypeRepositoryPrisma implements ITransportTypeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<TransportType | undefined> {
    const found = await this.prisma.transportType.findUnique({ where: { id } });
    return found ? toDomain(found) : undefined;
  }

  async findAll(request: PageRequest): Promise<Page<TransportType>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transportType.findMany({
        take: request.pageSize,
        skip: (request.page - 1) * request.pageSize,
        // Desempate por id: paginacao deterministica com createdAt igual.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.transportType.count(),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(transportType: TransportType, context: PersistenceContext): Promise<void> {
    const events = transportType.pullDomainEvents();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.transportType.create({
          data: {
            id: transportType.id,
            name: transportType.name,
            description: transportType.description,
            active: transportType.active,
            version: transportType.version,
            createdAt: transportType.createdAt,
            updatedAt: transportType.updatedAt,
          },
        });
        if (events.length > 0) {
          await tx.outboxEvent.createMany({
            data: events.map((event) => toOutboxEventData(event, context)),
          });
        }
      });
    } catch (err) {
      throw translateWriteError(err, transportType);
    }
  }

  async update(transportType: TransportType, context: PersistenceContext): Promise<void> {
    const events = transportType.pullDomainEvents();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Compare-and-set pela versao lida: duas alteracoes concorrentes no
        // mesmo tipo, so uma grava; a outra recebe 409.
        const updated = await tx.transportType.updateMany({
          where: { id: transportType.id, version: transportType.version },
          data: {
            name: transportType.name,
            description: transportType.description,
            active: transportType.active,
            updatedAt: transportType.updatedAt,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new TransportTypeConcurrentModificationError(transportType.id);
        }
        if (events.length > 0) {
          await tx.outboxEvent.createMany({
            data: events.map((event) => toOutboxEventData(event, context)),
          });
        }
      });
    } catch (err) {
      throw translateWriteError(err, transportType);
    }
  }
}

// P2002: nome unico violado (a constraint e a fonte de verdade, sem janela de
// corrida).
function translateWriteError(err: unknown, transportType: TransportType): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return new TransportTypeNameAlreadyExistsError(transportType.name);
  }
  return err;
}

function toDomain(row: TransportTypeModel): TransportType {
  return TransportType.restore({
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
