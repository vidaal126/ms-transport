import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { TransportType } from "../../domain/entities/transport-type.entity";
import {
  ITransportTypeRepository,
  TRANSPORT_TYPE_REPOSITORY,
} from "../../domain/repositories/transport-type.repository";

export interface CreateTransportTypeInput {
  name: string;
  dailyCapacity: number;
}

@Injectable()
export class CreateTransportTypeUseCase {
  constructor(
    @Inject(TRANSPORT_TYPE_REPOSITORY)
    private readonly transportTypeRepository: ITransportTypeRepository,
  ) {}

  async execute(input: CreateTransportTypeInput): Promise<TransportType> {
    const existing = await this.transportTypeRepository.findByName(input.name);
    if (existing) {
      throw new ConflictException(
        `TransportType com nome ${input.name} já existe`,
      );
    }

    const transportType = TransportType.create({
      name: input.name,
      dailyCapacity: input.dailyCapacity,
    });

    return this.transportTypeRepository.create(transportType);
  }
}
