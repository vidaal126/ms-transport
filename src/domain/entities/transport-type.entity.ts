export class InvalidTransportCapacityError extends Error {
  constructor() {
    super("dailyCapacity deve ser maior que zero");
    this.name = "InvalidTransportCapacityError";
  }
}

export class TransportCapacityExceededError extends Error {
  constructor() {
    super("Capacidade diária de transporte excedida");
    this.name = "TransportCapacityExceededError";
  }
}

export interface TransportTypeProps {
  id?: string;
  name: string;
  dailyCapacity: number;
  usedToday?: number;
  active?: boolean;
  createdAt?: Date;
}

export class TransportType {
  readonly id?: string;
  readonly name: string;
  readonly dailyCapacity: number;
  readonly usedToday: number;
  readonly active: boolean;
  readonly createdAt?: Date;

  private constructor(props: TransportTypeProps) {
    this.id = props.id;
    this.name = props.name;
    this.dailyCapacity = props.dailyCapacity;
    this.usedToday = props.usedToday ?? 0;
    this.active = props.active ?? true;
    this.createdAt = props.createdAt;
  }

  static create(props: TransportTypeProps): TransportType {
    if (props.dailyCapacity <= 0) {
      throw new InvalidTransportCapacityError();
    }
    return new TransportType(props);
  }

  isAvailable(): boolean {
    return this.active && this.usedToday < this.dailyCapacity;
  }

  // Retorna uma NOVA instância com usedToday incrementado - a entidade é
  // imutável (readonly em tudo), então "reservar" não muda o objeto atual,
  // cria um novo representando o próximo estado válido. Lança erro se a
  // capacidade já estiver esgotada, reaproveitando isAvailable() em vez
  // de duplicar a checagem usedToday < dailyCapacity.
  reserve(): TransportType {
    if (!this.isAvailable()) {
      throw new TransportCapacityExceededError();
    }
    return new TransportType({
      id: this.id,
      name: this.name,
      dailyCapacity: this.dailyCapacity,
      usedToday: this.usedToday + 1,
      active: this.active,
      createdAt: this.createdAt,
    });
  }
}
