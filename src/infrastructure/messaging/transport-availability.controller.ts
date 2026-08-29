import { Controller, Inject } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import {
  ITransportTypeRepository,
  TRANSPORT_TYPE_REPOSITORY,
} from "../../domain/repositories/transport-type.repository";

interface CheckAvailabilityMessage {
  transportTypeId: string;
}

interface CheckAvailabilityResponse {
  transportTypeId: string;
  available: boolean;
  dailyCapacity: number;
  usedToday: number;
}

@Controller()
export class TransportAvailabilityController {
  constructor(
    @Inject(TRANSPORT_TYPE_REPOSITORY)
    private readonly transportTypeRepository: ITransportTypeRepository,
  ) {}

  // @MessagePattern registra este método como handler RPC no RabbitMQ.
  // O NestJS escuta a fila configurada no main.ts, e quando chega uma
  // mensagem com esse pattern, executa o método e publica o RETORNO
  // automaticamente na fila de resposta (reply queue) do cliente que
  // perguntou - usando o correlationId da mensagem original pra ele
  // saber que resposta é essa.
  @MessagePattern("check_transport_availability")
  async checkAvailability(
    @Payload() message: CheckAvailabilityMessage,
  ): Promise<CheckAvailabilityResponse> {
    const transportType = await this.transportTypeRepository.findById(
      message.transportTypeId,
    );

    if (!transportType) {
      // Aqui NÃO lançamos NotFoundException do @nestjs/common (isso é
      // pensado pra HTTP). Em RPC, o padrão correto é devolver um erro
      // estruturado que o cliente saiba interpretar - vamos ajustar
      // isso já já, mas por ora deixamos simples pra você ver o
      // fluxo feliz funcionando primeiro.
      throw new Error(
        `TransportType ${message.transportTypeId} não encontrado`,
      );
    }

    return {
      transportTypeId: transportType.id!,
      available: transportType.isAvailable(),
      dailyCapacity: transportType.dailyCapacity,
      usedToday: transportType.usedToday,
    };
  }
}
