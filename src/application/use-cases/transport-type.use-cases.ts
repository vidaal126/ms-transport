import { TransportType } from "@domain/entities/transport-type.entity";
import { TransportTypeNotFoundError } from "@domain/errors/transport-type.errors";
import type {
  ITransportTypeRepository,
  PersistenceContext,
} from "@application/ports/transport-type.repository.port";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function resolvePageSize(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

export interface CreateTransportTypeInput {
  readonly name: string;
  readonly description?: string | undefined;
}

export class CreateTransportTypeUseCase {
  constructor(
    private readonly repository: ITransportTypeRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // Nome duplicado nao e pre-checado: a constraint unica e a fonte de verdade
  // e o repositorio traduz a violacao para erro de dominio.
  async execute(
    input: CreateTransportTypeInput,
    context: PersistenceContext,
  ): Promise<TransportType> {
    const transportType = TransportType.create({
      name: input.name,
      description: input.description,
      now: this.clock(),
    });
    await this.repository.create(transportType, context);
    return transportType;
  }
}

export interface UpdateTransportTypeInput {
  readonly id: string;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly active?: boolean | undefined;
}

export class UpdateTransportTypeUseCase {
  constructor(
    private readonly repository: ITransportTypeRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    input: UpdateTransportTypeInput,
    context: PersistenceContext,
  ): Promise<TransportType> {
    const transportType = await this.repository.findById(input.id);
    if (!transportType) throw new TransportTypeNotFoundError(input.id);

    const changed = transportType.update({
      name: input.name,
      description: input.description,
      active: input.active,
      now: this.clock(),
    });
    if (changed) await this.repository.update(transportType, context);
    return transportType;
  }
}

export class GetTransportTypeUseCase {
  constructor(private readonly repository: ITransportTypeRepository) {}

  async execute(id: string): Promise<TransportType> {
    const transportType = await this.repository.findById(id);
    if (!transportType) throw new TransportTypeNotFoundError(id);
    return transportType;
  }
}

export interface ListTransportTypesInput {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ListTransportTypesOutput {
  readonly items: TransportType[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export class ListTransportTypesUseCase {
  constructor(private readonly repository: ITransportTypeRepository) {}

  async execute(input: ListTransportTypesInput): Promise<ListTransportTypesOutput> {
    const page = input.page && input.page > 0 ? input.page : 1;
    const pageSize = resolvePageSize(input.limit);
    const { items, total } = await this.repository.findAll({ page, pageSize });
    return { items, total, page, pageSize };
  }
}
