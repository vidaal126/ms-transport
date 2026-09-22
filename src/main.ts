import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { type MicroserviceOptions, Transport } from "@nestjs/microservices";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { type Env, readEnv } from "@config/env";
import { AppModule } from "./app.module";

const RABBITMQ_QUEUE = "transport_availability_queue";

// Aplicacao hibrida: HTTP (leitura do read model e health checks) e o
// microservico RabbitMQ de disponibilidade no mesmo processo.
async function bootstrap(): Promise<void> {
  // abortOnError: false - erro de inicializacao (ex.: env invalida) sobe para
  // o catch de bootstrap, que imprime a mensagem e sai com codigo 1.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });

  app.useLogger(app.get(Logger));
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const rabbitmqUrl = readEnv(config, "RABBITMQ_URL");
  const port = readEnv(config, "PORT");

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue: RABBITMQ_QUEUE,
        queueOptions: {
          durable: false,
        },
      },
    },
    { inheritAppConfig: true },
  );

  await app.startAllMicroservices();
  await app.listen(port);

  app
    .get(Logger)
    .log(`ms-transport: HTTP na porta ${port} e RabbitMQ na fila ${RABBITMQ_QUEUE}`);
}

bootstrap().catch((err: unknown): void => {
  // Env invalida cai aqui antes do logger existir: mensagem direta no stderr.
  process.stderr.write(
    `Falha ao iniciar ms-transport: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
