import {
  EntityConflictError,
  EntityNotFoundError,
  InvariantViolationError,
} from "./domain.error";

export class TransportTypeNotFoundError extends EntityNotFoundError {
  constructor(readonly transportTypeId: string) {
    super(`Tipo de transporte ${transportTypeId} nao encontrado`);
  }
}

export class TransportTypeNameAlreadyExistsError extends EntityConflictError {
  constructor(readonly transportTypeName: string) {
    super(`Ja existe um tipo de transporte com o nome ${transportTypeName}`);
  }
}

// Outra requisicao alterou o tipo entre a leitura e a gravacao.
export class TransportTypeConcurrentModificationError extends EntityConflictError {
  constructor(readonly transportTypeId: string) {
    super(`Tipo de transporte ${transportTypeId} foi alterado por outra requisicao; tente de novo`);
  }
}

export class InvalidTransportTypeError extends InvariantViolationError {}
