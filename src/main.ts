import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { type MicroserviceOptions, Transport } from "@nestjs/microservices";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { type Env, readEnv } from "@config/env";
import { AppModule } from "./app.module";

const RABBITMQ_QUEUE = "transport_availability_queue";
const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

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

  registerGracefulShutdown(app, readEnv(config, "SHUTDOWN_TIMEOUT_MS"));

  await app.startAllMicroservices();
  await app.listen(port);

  app
    .get(Logger)
    .log(`ms-transport: HTTP na porta ${port} e RabbitMQ na fila ${RABBITMQ_QUEUE}`);
}

// Substitui app.enableShutdownHooks() para impor um teto de tempo: app.close()
// dispara onModuleDestroy (consumer Kafka para e aguarda a mensagem em
// andamento), fecha o microservico RabbitMQ e o servidor HTTP e so entao
// onApplicationShutdown (desconecta producer e Prisma). Estourado o teto, o
// processo sai com erro.
function registerGracefulShutdown(app: INestApplication, timeoutMs: number): void {
  const logger = app.get(Logger);
  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.log(`${signal} recebido, encerrando (timeout ${timeoutMs}ms)`);

    const forceExit = setTimeout((): void => {
      logger.error(`Shutdown excedeu ${timeoutMs}ms, encerrando a forca`);
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    let exitCode = 0;
    try {
      await app.close();
      logger.log("Shutdown concluido");
    } catch (err) {
      logger.error("Falha no shutdown", err instanceof Error ? err.stack : String(err));
      exitCode = 1;
    } finally {
      clearTimeout(forceExit);
    }
    // Saida explicita: um handle esquecido (socket, timer) nao pode deixar o
    // processo vivo depois do shutdown.
    process.exit(exitCode);
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, (): void => {
      void shutdown(signal);
    });
  }
}

bootstrap().catch((err: unknown): void => {
  // Env invalida cai aqui antes do logger existir: mensagem direta no stderr.
  process.stderr.write(
    `Falha ao iniciar ms-transport: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
