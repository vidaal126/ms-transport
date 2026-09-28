import {
  TransportTypeConcurrentModificationError,
  TransportTypeNameAlreadyExistsError,
  TransportTypeNotFoundError,
} from "@domain/errors/transport-type.errors";
import { InMemoryTransportTypeRepository } from "../../test/transport-type.fakes";
import {
  CreateTransportTypeUseCase,
  GetTransportTypeUseCase,
  ListTransportTypesUseCase,
  UpdateTransportTypeUseCase,
} from "./transport-type.use-cases";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const LATER = new Date("2026-09-27T13:00:00.000Z");
const context = { correlationId: "corr-1" };

describe("casos de uso de TransportType", () => {
  let repository: InMemoryTransportTypeRepository;

  beforeEach(() => {
    repository = new InMemoryTransportTypeRepository();
  });

  it("criar grava o agregado e o evento com o correlationId", async () => {
    const created = await new CreateTransportTypeUseCase(repository, () => NOW).execute(
      { name: "Caminhao" },
      context,
    );

    expect(repository.rows.get(created.id)).toMatchObject({ id: created.id, name: "Caminhao", version: 0 });
    expect(repository.outbox).toHaveLength(1);
    expect(repository.outbox[0]).toMatchObject({
      event: { eventType: "TransportTypeCreated", aggregateId: created.id },
      context,
    });
  });

  it("criar com nome repetido propaga o erro de conflito", async () => {
    const create = new CreateTransportTypeUseCase(repository, () => NOW);
    await create.execute({ name: "Caminhao" }, context);

    await expect(create.execute({ name: "Caminhao" }, context)).rejects.toBeInstanceOf(
      TransportTypeNameAlreadyExistsError,
    );
  });

  it("atualizar inexistente lanca TransportTypeNotFoundError", async () => {
    await expect(
      new UpdateTransportTypeUseCase(repository).execute(
        { id: "11111111-1111-4111-8111-111111111111", active: false },
        context,
      ),
    ).rejects.toBeInstanceOf(TransportTypeNotFoundError);
  });

  it("atualizar sem mudanca nao persiste nem publica", async () => {
    const created = await new CreateTransportTypeUseCase(repository, () => NOW).execute(
      { name: "Caminhao" },
      context,
    );

    await new UpdateTransportTypeUseCase(repository, () => LATER).execute(
      { id: created.id, name: "Caminhao" },
      context,
    );

    expect(repository.updates).toBe(0);
    expect(repository.outbox).toHaveLength(1);
  });

  it("atualizar com mudanca persiste e publica TransportTypeUpdated", async () => {
    const created = await new CreateTransportTypeUseCase(repository, () => NOW).execute(
      { name: "Caminhao" },
      context,
    );

    const updated = await new UpdateTransportTypeUseCase(repository, () => LATER).execute(
      { id: created.id, active: false },
      context,
    );

    expect(updated.active).toBe(false);
    expect(repository.updates).toBe(1);
    expect(repository.outbox.map((entry) => entry.event.eventType)).toEqual([
      "TransportTypeCreated",
      "TransportTypeUpdated",
    ]);
  });

  it("atualizar incrementa a versao gravada", async () => {
    const created = await new CreateTransportTypeUseCase(repository, () => NOW).execute(
      { name: "Caminhao" },
      context,
    );

    await new UpdateTransportTypeUseCase(repository, () => LATER).execute(
      { id: created.id, active: false },
      context,
    );

    expect(repository.rows.get(created.id)?.version).toBe(1);
  });

  it("gravacao concorrente com versao antiga: TransportTypeConcurrentModificationError", async () => {
    const created = await new CreateTransportTypeUseCase(repository, () => NOW).execute(
      { name: "Caminhao" },
      context,
    );
    // Duas requisicoes leem a mesma versao; a primeira grava antes.
    const stale = await repository.findById(created.id);
    if (!stale) throw new Error("tipo recem-criado nao encontrado");
    await new UpdateTransportTypeUseCase(repository, () => LATER).execute(
      { id: created.id, name: "Carreta" },
      context,
    );
    stale.update({ active: false, now: LATER });

    await expect(repository.update(stale, context)).rejects.toBeInstanceOf(
      TransportTypeConcurrentModificationError,
    );
    expect(repository.rows.get(created.id)).toMatchObject({ name: "Carreta", active: true, version: 1 });
    expect(repository.outbox.map((entry) => entry.event.eventType)).toEqual([
      "TransportTypeCreated",
      "TransportTypeUpdated",
    ]);
  });

  it("buscar inexistente lanca TransportTypeNotFoundError", async () => {
    await expect(
      new GetTransportTypeUseCase(repository).execute("11111111-1111-4111-8111-111111111111"),
    ).rejects.toBeInstanceOf(TransportTypeNotFoundError);
  });

  it("listar aplica pagina padrao e limite maximo", async () => {
    const output = await new ListTransportTypesUseCase(repository).execute({ limit: 500 });

    expect(output).toMatchObject({ page: 1, pageSize: 100, total: 0 });
  });
});
