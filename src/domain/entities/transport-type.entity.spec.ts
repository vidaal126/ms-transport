import { InvalidTransportTypeError } from "@domain/errors/transport-type.errors";
import {
  TransportTypeCreatedEvent,
  TransportTypeUpdatedEvent,
} from "@domain/events/transport-type.events";
import { TransportType } from "./transport-type.entity";

const T0 = new Date("2026-09-27T12:00:00.000Z");
const T1 = new Date("2026-09-27T13:00:00.000Z");

describe("TransportType", () => {
  it("create normaliza, gera id e registra TransportTypeCreated", () => {
    const transportType = TransportType.create({
      name: "  Caminhao bau ",
      description: "  ",
      now: T0,
    });

    expect(transportType.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(transportType.name).toBe("Caminhao bau");
    expect(transportType.description).toBeNull();
    expect(transportType.active).toBe(true);

    const events = transportType.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(TransportTypeCreatedEvent);
    expect(events[0]).toMatchObject({
      aggregateId: transportType.id,
      occurredAt: T0,
      snapshot: { name: "Caminhao bau", description: null, active: true },
    });
    expect(transportType.pullDomainEvents()).toHaveLength(0);
  });

  it.each([
    ["vazio", "   "],
    ["acima de 100 caracteres", "x".repeat(101)],
  ])("rejeita nome %s", (_label, name) => {
    expect(() => TransportType.create({ name, now: T0 })).toThrow(InvalidTransportTypeError);
  });

  it("rejeita descricao acima de 500 caracteres", () => {
    expect(() =>
      TransportType.create({ name: "Moto", description: "x".repeat(501), now: T0 }),
    ).toThrow(InvalidTransportTypeError);
  });

  it("update com mudanca registra TransportTypeUpdated e avanca updatedAt", () => {
    const transportType = TransportType.create({ name: "Moto", now: T0 });
    transportType.pullDomainEvents();

    const changed = transportType.update({ active: false, description: "Entrega rapida", now: T1 });

    expect(changed).toBe(true);
    expect(transportType.updatedAt).toEqual(T1);
    const [event] = transportType.pullDomainEvents();
    expect(event).toBeInstanceOf(TransportTypeUpdatedEvent);
    expect(event?.snapshot).toEqual({ name: "Moto", description: "Entrega rapida", active: false });
  });

  it("update sem mudanca nao registra evento nem altera updatedAt", () => {
    const transportType = TransportType.create({ name: "Moto", description: "X", now: T0 });
    transportType.pullDomainEvents();

    expect(transportType.update({ name: " Moto ", description: "X", now: T1 })).toBe(false);
    expect(transportType.updatedAt).toEqual(T0);
    expect(transportType.pullDomainEvents()).toHaveLength(0);
  });

  it("update com description null limpa a descricao", () => {
    const transportType = TransportType.create({ name: "Moto", description: "X", now: T0 });

    transportType.update({ description: null, now: T1 });

    expect(transportType.description).toBeNull();
  });

  it("restore nao registra evento", () => {
    const restored = TransportType.restore({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Moto",
      description: null,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    });

    expect(restored.pullDomainEvents()).toHaveLength(0);
  });
});
