import { InvalidCatalogItemError } from "@domain/errors/catalog-item.errors";
import {
  Dimensions,
  type DimensionsProps,
} from "@domain/value-objects/dimensions.value-object";

export interface CatalogItemProps {
  readonly itemId: string;
  readonly sku: string;
  readonly weightKg: number;
  readonly dimensions: DimensionsProps;
  // Evento de origem da versao atual: permite rastrear e descartar eventos
  // mais antigos que cheguem fora de ordem.
  readonly sourceEventId: string;
  readonly sourceOccurredAt: Date;
}

// Projecao local do item do ms-catalog com apenas o que transporte precisa.
// Mesmas invariantes fisicas do catalogo: um evento que as viole e dado
// corrompido na origem, nao algo que o transporte deva aceitar.
export class CatalogItem {
  private static readonly WEIGHT_SCALE = 3;
  private static readonly MIN_WEIGHT_KG = 0.001;
  private static readonly MAX_WEIGHT_KG = 1000;

  private constructor(
    readonly itemId: string,
    readonly sku: string,
    readonly weightKg: number,
    readonly dimensions: Dimensions,
    readonly sourceEventId: string,
    readonly sourceOccurredAt: Date,
  ) {}

  static fromCatalogEvent(props: CatalogItemProps): CatalogItem {
    if (props.itemId.trim() === "") {
      throw new InvalidCatalogItemError("itemId nao pode ser vazio");
    }
    if (props.sku.trim() === "") {
      throw new InvalidCatalogItemError("sku nao pode ser vazio");
    }
    CatalogItem.assertValidWeight(props.weightKg);

    return CatalogItem.restore(props);
  }

  static restore(props: CatalogItemProps): CatalogItem {
    return new CatalogItem(
      props.itemId,
      props.sku,
      props.weightKg,
      Dimensions.create(props.dimensions),
      props.sourceEventId,
      props.sourceOccurredAt,
    );
  }

  private static assertValidWeight(weightKg: number): void {
    if (!Number.isFinite(weightKg)) {
      throw new InvalidCatalogItemError("weightKg must be a finite number");
    }
    if (weightKg < CatalogItem.MIN_WEIGHT_KG) {
      throw new InvalidCatalogItemError(
        `weightKg must be at least ${CatalogItem.MIN_WEIGHT_KG}`,
      );
    }
    if (weightKg > CatalogItem.MAX_WEIGHT_KG) {
      throw new InvalidCatalogItemError(
        `weightKg must not exceed ${CatalogItem.MAX_WEIGHT_KG}`,
      );
    }
    const [, decimals = ""] = weightKg.toString().split(".");
    if (decimals.length > CatalogItem.WEIGHT_SCALE) {
      throw new InvalidCatalogItemError(
        `weightKg must have at most ${CatalogItem.WEIGHT_SCALE} decimal places`,
      );
    }
  }
}
