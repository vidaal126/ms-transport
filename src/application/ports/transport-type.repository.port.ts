import type { TransportType } from "@domain/entities/transport-type.entity";

export const TRANSPORT_TYPE_REPOSITORY = Symbol("TRANSPORT_TYPE_REPOSITORY");

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export interface Page<T> {
  readonly items: T[];
  readonly total: number;
}

// Metadados que acompanham os eventos do agregado ate o outbox.
export interface PersistenceContext {
  readonly correlationId: string;
}

export interface ITransportTypeRepository {
  findById(id: string): Promise<TransportType | undefined>;
  findAll(request: PageRequest): Promise<Page<TransportType>>;
  // Persistem o agregado e gravam seus eventos no outbox na mesma transacao.
  // Nome duplicado: TransportTypeNameAlreadyExistsError.
  create(transportType: TransportType, context: PersistenceContext): Promise<void>;
  // Controle otimista pela versao lida: TransportTypeConcurrentModificationError
  // se outra requisicao gravou antes.
  update(transportType: TransportType, context: PersistenceContext): Promise<void>;
}
