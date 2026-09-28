import { EntityNotFoundError, InvariantViolationError } from "./domain.error";

export class CatalogItemNotFoundError extends EntityNotFoundError {
  constructor(readonly itemId: string) {
    super(`Item de catalogo ${itemId} nao encontrado no read model`);
  }
}

export class InvalidCatalogItemError extends InvariantViolationError {}
