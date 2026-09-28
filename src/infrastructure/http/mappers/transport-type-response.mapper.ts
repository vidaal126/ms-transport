import type { TransportType } from "@domain/entities/transport-type.entity";
import type { ListTransportTypesOutput } from "@application/use-cases/transport-type.use-cases";
import type {
  PaginatedTransportTypesResponseDto,
  TransportTypeResponseDto,
} from "@infrastructure/http/dto/transport-type.dto";

export function toTransportTypeResponse(transportType: TransportType): TransportTypeResponseDto {
  return {
    id: transportType.id,
    name: transportType.name,
    description: transportType.description,
    active: transportType.active,
    createdAt: transportType.createdAt.toISOString(),
    updatedAt: transportType.updatedAt.toISOString(),
  };
}

export function toPaginatedTransportTypesResponse(
  output: ListTransportTypesOutput,
): PaginatedTransportTypesResponseDto {
  return {
    items: output.items.map(toTransportTypeResponse),
    total: output.total,
    page: output.page,
    pageSize: output.pageSize,
  };
}
