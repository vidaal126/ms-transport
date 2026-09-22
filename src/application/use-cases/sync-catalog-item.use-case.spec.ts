import { InvariantViolationError } from "@domain/errors/domain.error";
import { InMemoryCatalogItemRepository } from "../../test/catalog-item.fakes";
import { type CatalogItemEvent, SyncCatalogItemUseCase } from "./sync-catalog-item.use-case";

const event: CatalogItemEvent = {
  eventId: "evt-1",
  eventType: "ItemCreated",
  occurredAt: new Date("2026-09-03T01:56:10.122Z"),
  itemId: "item-1",
  sku: "BOX-001",
  weightKg: 0.75,
  dimensions: { lengthCm: 40, widthCm: 30, heightCm: 25 },
};

describe("SyncCatalogItemUseCase", () => {
  let repository: InMemoryCatalogItemRepository;
  let useCase: SyncCatalogItemUseCase;

  beforeEach(() => {
    repository = new InMemoryCatalogItemRepository();
    useCase = new SyncCatalogItemUseCase(repository);
  });

  it("aplica o item com o evento de origem", async () => {
    await expect(useCase.execute(event)).resolves.toBe("applied");

    const stored = repository.items.get("item-1");
    expect(stored?.sourceEventId).toBe("evt-1");
    expect(stored?.sourceOccurredAt).toEqual(event.occurredAt);
  });

  it("mesmo eventId de novo: duplicate, sem alterar o registro", async () => {
    await useCase.execute(event);
    const before = repository.items.get("item-1");

    await expect(useCase.execute({ ...event, weightKg: 9 })).resolves.toBe("duplicate");
    expect(repository.items.get("item-1")).toBe(before);
  });

  it("evento novo porem mais antigo: stale", async () => {
    await useCase.execute(event);

    await expect(
      useCase.execute({ ...event, eventId: "evt-0", occurredAt: new Date("2026-09-01T00:00:00Z") }),
    ).resolves.toBe("stale");
    expect(repository.items.get("item-1")?.sourceEventId).toBe("evt-1");
  });

  it("invariante violada: lanca InvariantViolationError sem gravar", async () => {
    await expect(useCase.execute({ ...event, weightKg: 0 })).rejects.toBeInstanceOf(
      InvariantViolationError,
    );
    expect(repository.processed.size).toBe(0);
  });
});
