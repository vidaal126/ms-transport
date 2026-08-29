import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672"],
        queue: "transport_availability_queue",
        queueOptions: {
          durable: false,
        },
      },
      bufferLogs: true,
    },
  );

  app.useLogger(app.get(Logger));

  await app.listen();
  app.get(Logger).log(
    "ms-transport (RabbitMQ) escutando na fila transport_availability_queue",
  );
}
bootstrap();
