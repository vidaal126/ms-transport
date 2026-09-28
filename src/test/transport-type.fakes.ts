import type { TransportType } from "@domain/entities/transport-type.entity";
import { TransportTypeNameAlreadyExistsError } from "@domain/errors/transport-type.errors";
import type { TransportTypeEvent } from "@domain/events/transport-type.events";
import type {
  ITransportTypeRepository,
  Page,
  PageRequest,
  PersistenceContext,
} from "@application/ports/transport-type.repository.port";

// Repositorio em memoria: guarda os eventos "gravados no outbox" para os
// testes verificarem o que seria publicado.
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
    this.rows.set(transportType.id, transportType);
    this.pushEvents(transportType, context);
  }

  async update(transportType: TransportType, context: PersistenceContext): Promise<void> {
    this.updates += 1;
    this.rows.set(transportType.id, transportType);
    this.pushEvents(transportType, context);
  }

  private pushEvents(transportType: TransportType, context: PersistenceContext): void {
    for (const event of transportType.pullDomainEvents()) {
      this.outbox.push({ event, context });
    }
  }
}
