import { Injectable, NotFoundException } from "@nestjs/common";
import { TransportType } from "../../../domain/entities/transport-type.entity";
import { ITransportTypeRepository } from "../../../domain/repositories/transport-type.repository";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TransportTypeRepositoryPrisma implements ITransportTypeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<TransportType | undefined> {
    const found = await this.prisma.transportType.findUnique({ where: { id } });
    if (!found) return undefined;
    return this.toDomain(found);
  }

  async findByName(name: string): Promise<TransportType | undefined> {
    const found = await this.prisma.transportType.findUnique({
      where: { name },
    });
    if (!found) return undefined;
    return this.toDomain(found);
  }

  async findAll(): Promise<TransportType[]> {
    const all = await this.prisma.transportType.findMany();
    return all.map((t) => this.toDomain(t));
  }

  async create(transportType: TransportType): Promise<TransportType> {
    const created = await this.prisma.transportType.create({
      data: {
        name: transportType.name,
        dailyCapacity: transportType.dailyCapacity,
        usedToday: transportType.usedToday,
        active: transportType.active,
      },
    });
    return this.toDomain(created);
  }

  async incrementUsage(id: string): Promise<TransportType> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundException(`TransportType ${id} não encontrado`);
    }

    const reserved = current.reserve(); // entidade valida e decide

    const updated = await this.prisma.transportType.update({
      where: { id },
      data: { usedToday: reserved.usedToday },
    });

    return this.toDomain(updated);
  }

  private toDomain(raw: {
    id: string;
    name: string;
    dailyCapacity: number;
    usedToday: number;
    active: boolean;
    createdAt: Date;
  }): TransportType {
    return TransportType.create({
      id: raw.id,
      name: raw.name,
      dailyCapacity: raw.dailyCapacity,
      usedToday: raw.usedToday,
      active: raw.active,
      createdAt: raw.createdAt,
    });
  }
}
