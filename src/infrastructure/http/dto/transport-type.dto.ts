import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import {
  TRANSPORT_TYPE_DESCRIPTION_MAX_LENGTH,
  TRANSPORT_TYPE_NAME_MAX_LENGTH,
} from "@domain/entities/transport-type.entity";

export class CreateTransportTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TRANSPORT_TYPE_NAME_MAX_LENGTH)
  readonly name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(TRANSPORT_TYPE_DESCRIPTION_MAX_LENGTH)
  readonly description?: string;
}

// Campos ausentes sao mantidos; description: null limpa a descricao.
// name e active usam ValidateIf(!== undefined) em vez de IsOptional: IsOptional
// tambem aceitaria null, que nao tem significado para eles.
const isPresent = (_dto: object, value: unknown): boolean => value !== undefined;

export class UpdateTransportTypeDto {
  @ValidateIf(isPresent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TRANSPORT_TYPE_NAME_MAX_LENGTH)
  readonly name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TRANSPORT_TYPE_DESCRIPTION_MAX_LENGTH)
  readonly description?: string | null;

  @ValidateIf(isPresent)
  @IsBoolean()
  readonly active?: boolean;
}

export class ListTransportTypesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit?: number;
}

export class TransportTypeResponseDto {
  readonly id!: string;
  readonly name!: string;
  readonly description!: string | null;
  readonly active!: boolean;
  readonly createdAt!: string;
  readonly updatedAt!: string;
}

export class PaginatedTransportTypesResponseDto {
  readonly items!: TransportTypeResponseDto[];
  readonly total!: number;
  readonly page!: number;
  readonly pageSize!: number;
}
