import { randomUUID } from "node:crypto";
import { InvalidTransportTypeError } from "@domain/errors/transport-type.errors";
import {
  TransportTypeCreatedEvent,
  type TransportTypeEvent,
  type TransportTypeSnapshot,
  TransportTypeUpdatedEvent,
} from "@domain/events/transport-type.events";
import { AggregateRoot } from "./aggregate-root";

export const TRANSPORT_TYPE_NAME_MAX_LENGTH = 100;
export const TRANSPORT_TYPE_DESCRIPTION_MAX_LENGTH = 500;

export interface CreateTransportTypeProps {
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly now: Date;
}

export interface RestoreTransportTypeProps {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// undefined = campo nao informado (mantem); null em description = limpar.
export interface UpdateTransportTypeProps {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly active?: boolean | undefined;
  readonly now: Date;
}

// Dono do tipo de transporte (monolito: TransportType). Cliente e ordem de
// venda mantem replicas via eventos; nenhum outro servico escreve aqui.
export class TransportType extends AggregateRoot<TransportTypeEvent> {
  private constructor(
    readonly id: string,
    private _name: string,
    private _description: string | null,
    private _active: boolean,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {
    super();
  }

  static create(props: CreateTransportTypeProps): TransportType {
    const transportType = new TransportType(
      randomUUID(),
      normalizeName(props.name),
      normalizeDescription(props.description ?? null),
      true,
      props.now,
      props.now,
    );
    transportType.record(
      new TransportTypeCreatedEvent(transportType.id, props.now, transportType.snapshot()),
    );
    return transportType;
  }

  // Reidratacao do banco: dado ja validado na escrita, nenhum evento.
  static restore(props: RestoreTransportTypeProps): TransportType {
    return new TransportType(
      props.id,
      props.name,
      props.description,
      props.active,
      props.createdAt,
      props.updatedAt,
    );
  }

  get name(): string {
    return this._name;
  }

  get description(): string | null {
    return this._description;
  }

  get active(): boolean {
    return this._active;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // Registra TransportTypeUpdated so quando algo muda: reenviar o mesmo PUT
  // nao gera evento nem altera updatedAt.
  update(props: UpdateTransportTypeProps): boolean {
    const name = props.name === undefined ? this._name : normalizeName(props.name);
    const description =
      props.description === undefined
        ? this._description
        : normalizeDescription(props.description);
    const active = props.active ?? this._active;

    if (name === this._name && description === this._description && active === this._active) {
      return false;
    }

    this._name = name;
    this._description = description;
    this._active = active;
    this._updatedAt = props.now;
    this.record(new TransportTypeUpdatedEvent(this.id, props.now, this.snapshot()));
    return true;
  }

  snapshot(): TransportTypeSnapshot {
    return { name: this._name, description: this._description, active: this._active };
  }
}

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) {
    throw new InvalidTransportTypeError("Nome do tipo de transporte e obrigatorio");
  }
  if (name.length > TRANSPORT_TYPE_NAME_MAX_LENGTH) {
    throw new InvalidTransportTypeError(
      `Nome do tipo de transporte excede ${TRANSPORT_TYPE_NAME_MAX_LENGTH} caracteres`,
    );
  }
  return name;
}

function normalizeDescription(raw: string | null): string | null {
  if (raw === null) return null;
  const description = raw.trim();
  if (description.length === 0) return null;
  if (description.length > TRANSPORT_TYPE_DESCRIPTION_MAX_LENGTH) {
    throw new InvalidTransportTypeError(
      `Descricao excede ${TRANSPORT_TYPE_DESCRIPTION_MAX_LENGTH} caracteres`,
    );
  }
  return description;
}
