import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type MicroserviceOptions, Transport } from "@nestjs/microservices";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

const RABBITMQ_QUEUE = "transport_availability_queue";
const DEFAULT_HTTP_PORT = 3001;

// Aplicacao hibrida: HTTP (leitura do read model e health checks) e o
// microservico RabbitMQ de disponibilidade no mesmo processo.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672"],
        queue: RABBITMQ_QUEUE,
        queueOptions: {
          durable: false,
        },
      },
    },
    { inheritAppConfig: true },
  );

  const port = Number(process.env.PORT ?? DEFAULT_HTTP_PORT);

  await app.startAllMicroservices();
  await app.listen(port);

  app
    .get(Logger)
    .log(`ms-transport: HTTP na porta ${port} e RabbitMQ na fila ${RABBITMQ_QUEUE}`);
}

void bootstrap();
