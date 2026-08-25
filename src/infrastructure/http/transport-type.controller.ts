import { Body, Controller, Post } from "@nestjs/common";
import { CreateTransportTypeUseCase } from "../../application/use-cases/create-transport-type.use-case";
import { CreateTransportTypeDto } from "./dto/create-transport-type.dto";

@Controller("transport-types")
export class TransportTypeController {
  constructor(
    private readonly createTransportTypeUseCase: CreateTransportTypeUseCase,
  ) {}

  @Post()
  async create(@Body() dto: CreateTransportTypeDto) {
    return this.createTransportTypeUseCase.execute(dto);
  }
}
