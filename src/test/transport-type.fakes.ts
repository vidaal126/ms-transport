import { TransportType } from "@domain/entities/transport-type.entity";
import {
  TransportTypeConcurrentModificationError,
  TransportTypeNameAlreadyExistsError,
} from "@domain/errors/transport-type.errors";
import type { TransportTypeEvent } from "@domain/events/transport-type.events";
import type {
  ITransportTypeRepository,
  Page,
  PageRequest,
  PersistenceContext,
} from "@application/ports/transport-type.repository.port";

// Repositorio em memoria: guarda os eventos "gravados no outbox" para os
// testes verificarem o que seria publicado. Guarda copias (como o banco), para
// que duas leituras do mesmo id sejam instancias independentes.
export class InMemoryTransportTypeRepository implements ITransportTypeRepository {
  readonly rows = new Map<string, TransportType>();
  readonly outbox: Array<{ event: TransportTypeEvent; context: PersistenceContext }> = [];
  updates = 0;

  async findById(id: string): Promise<TransportType | undefined> {
    return this.rows.get(id);
  }

  async findAll(request: PageRequest): Promise<Page<TransportType>> {
    const all = [...this.rows.values()];
    const start = (request.page - 1) * request.pageSize;
    return { items: all.slice(start, start + request.pageSize), total: all.length };
  }

  async create(transportType: TransportType, context: PersistenceContext): Promise<void> {
    const duplicated = [...this.rows.values()].some((t) => t.name === transportType.name);
    if (duplicated) throw new TransportTypeNameAlreadyExistsError(transportType.name);
    this.pushEvents(transportType, context);
    this.rows.set(transportType.id, snapshot(transportType, transportType.version));
  }

  async update(transportType: TransportType, context: PersistenceContext): Promise<void> {
    const stored = this.rows.get(transportType.id);
    if (stored?.version !== transportType.version) {
      throw new TransportTypeConcurrentModificationError(transportType.id);
    }
    this.updates += 1;
    this.pushEvents(transportType, context);
    this.rows.set(transportType.id, snapshot(transportType, transportType.version + 1));
  }

  private pushEvents(transportType: TransportType, context: PersistenceContext): void {
    for (const event of transportType.pullDomainEvents()) {
      this.outbox.push({ event, context });
    }
  }
}

function snapshot(transportType: TransportType, version: number): TransportType {
  return TransportType.restore({
    id: transportType.id,
    name: transportType.name,
    description: transportType.description,
    active: transportType.active,
    version,
    createdAt: transportType.createdAt,
    updatedAt: transportType.updatedAt,
  });
}
