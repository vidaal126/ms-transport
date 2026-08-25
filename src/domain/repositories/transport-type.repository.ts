import { TransportType } from "@domain/entities/transport-type.entity";

export const TRANSPORT_TYPE_REPOSITORY = Symbol("TRANSPORT_TYPE_REPOSITORY");

export interface ITransportTypeRepository {
  findById(id: string): Promise<TransportType | undefined>;
  findByName(name: string): Promise<TransportType | undefined>;
  findAll(): Promise<TransportType[]>;
  create(transportType: TransportType): Promise<TransportType>;
  incrementUsage(id: string): Promise<TransportType>;
}
