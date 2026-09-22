export class DimensionsResponseDto {
  readonly lengthCm!: number;
  readonly widthCm!: number;
  readonly heightCm!: number;
}

export class CatalogItemResponseDto {
  readonly itemId!: string;
  readonly sku!: string;
  readonly weightKg!: number;
  readonly dimensions!: DimensionsResponseDto;
  readonly sourceEventId!: string;
  readonly sourceOccurredAt!: string;
}
