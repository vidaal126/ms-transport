import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type RmqOptions, Transport } from "@nestjs/microservices";
import {
  type HealthIndicatorResult,
  HealthIndicatorService,
  MicroserviceHealthIndicator,
} from "@nestjs/terminus";
import { type ILogger, LOGGER_TOKEN } from "@common/logger/logger.interface";
import { type Env, readEnv } from "@config/env";

// Envolve o indicador do terminus: em falha ele devolve a mensagem de erro de
// conexao (host/porta) no corpo; aqui ela vai so para o log.
@Injectable()
export class RabbitMqHealthIndicator {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly microservice: MicroserviceHealthIndicator,
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger,
    config: ConfigService<Env, true>,
  ) {
    this.url = readEnv(config, "RABBITMQ_URL");
    this.timeoutMs = readEnv(config, "HEALTH_CHECK_TIMEOUT_MS");
  }

  async isHealthy<const K extends string>(key: K): Promise<HealthIndicatorResult<K>> {
    const indicator = this.healthIndicatorService.check(key);
    const result = await this.microservice.pingCheck<RmqOptions>(key, {
      transport: Transport.RMQ,
      options: { urls: [this.url] },
      timeout: this.timeoutMs,
    });
    if (result[key]?.status === "up") return indicator.up();

    this.logger.warn("RabbitMQ indisponivel no health check", { details: result[key] });
    return indicator.down({ message: "indisponivel" });
  }
}
