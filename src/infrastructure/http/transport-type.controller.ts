import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  CreateTransportTypeUseCase,
  GetTransportTypeUseCase,
  ListTransportTypesUseCase,
  UpdateTransportTypeUseCase,
} from "@application/use-cases/transport-type.use-cases";
import { CorrelationId } from "./decorators/correlation-id.decorator";
import {
  CreateTransportTypeDto,
  ListTransportTypesQueryDto,
  type PaginatedTransportTypesResponseDto,
  type TransportTypeResponseDto,
  UpdateTransportTypeDto,
} from "./dto/transport-type.dto";
import {
  toPaginatedTransportTypesResponse,
  toTransportTypeResponse,
} from "./mappers/transport-type-response.mapper";

@Controller("transport-types")
export class TransportTypeController {
  constructor(
    private readonly createTransportType: CreateTransportTypeUseCase,
    private readonly updateTransportType: UpdateTransportTypeUseCase,
    private readonly getTransportType: GetTransportTypeUseCase,
    private readonly listTransportTypes: ListTransportTypesUseCase,
  ) {}

  @Post()
  async create(
    @Body() dto: CreateTransportTypeDto,
    @CorrelationId() correlationId: string,
  ): Promise<TransportTypeResponseDto> {
    const created = await this.createTransportType.execute(dto, { correlationId });
    return toTransportTypeResponse(created);
  }

  @Put(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransportTypeDto,
    @CorrelationId() correlationId: string,
  ): Promise<TransportTypeResponseDto> {
    const updated = await this.updateTransportType.execute(
      { id, name: dto.name, description: dto.description, active: dto.active },
      { correlationId },
    );
    return toTransportTypeResponse(updated);
  }

  @Get()
  async findAll(
    @Query() query: ListTransportTypesQueryDto,
  ): Promise<PaginatedTransportTypesResponseDto> {
    return toPaginatedTransportTypesResponse(await this.listTransportTypes.execute(query));
  }

  @Get(":id")
  async findById(@Param("id", ParseUUIDPipe) id: string): Promise<TransportTypeResponseDto> {
    return toTransportTypeResponse(await this.getTransportType.execute(id));
  }
}
