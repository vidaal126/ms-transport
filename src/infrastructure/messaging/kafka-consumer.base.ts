import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { Consumer, IHeaders, Kafka, KafkaMessage } from "kafkajs";
import { runWithCorrelationId } from "@common/correlation/correlation-context";
import { resolveCorrelationId } from "@common/correlation/correlation-id";
import type { ILogger } from "@common/logger/logger.interface";
import { EVENT_HEADERS } from "./event-envelope";

export interface ConsumerRetryPolicy {
  // Tentativas por mensagem (backoff exponencial do KafkaJS) antes de o
  // consumer crashar e reiniciar.
  readonly retries: number;
  readonly initialRetryTimeMs: number;
  readonly maxRetryTimeMs: number;
}

export interface ConsumerSubscription {
  readonly groupId: string;
  readonly topics: readonly string[];
  readonly fromBeginning: boolean;
  readonly retry: ConsumerRetryPolicy;
}

export interface InboundMessage {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
  readonly timestamp: string;
  readonly key: string | null;
  // Bruto e intacto: parse e validacao sao do handler (e a DLT precisa do
  // payload original).
  readonly value: Buffer | null;
  readonly headers: Readonly<Record<string, string>>;
}

// starting: ainda nao entrou no grupo.
// running: consumindo normalmente.
// degraded: crashou (retry esgotado ou broker fora) e esta tentando voltar.
// stopped: desligado no shutdown.
export type ConsumerStatus = "starting" | "running" | "degraded" | "stopped";

export interface ConsumerHealth {
  readonly status: ConsumerStatus;
  readonly since: Date;
  readonly lastError?: string;
}

const MAX_START_BACKOFF_MS = 30_000;
const START_BACKOFF_BASE_MS = 1_000;

// Base para consumers: conexao, subscribe, contexto de log com correlationId,
// estado para health check, recuperacao automatica e desligamento. Politica
// de erro por mensagem (DLT vs retry) fica no handler concreto: lancar erro
// = nao commitar e reprocessar.
export abstract class KafkaConsumerBase
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private consumer: Consumer | null = null;
  private health: ConsumerHealth = { status: "starting", since: new Date() };
  private isStopping = false;
  private startTimer: NodeJS.Timeout | null = null;
  private startAttempt: Promise<void> | null = null;

  protected constructor(
    private readonly kafka: Kafka,
    protected readonly logger: ILogger,
  ) {}

  protected abstract readonly subscription: ConsumerSubscription;

  protected abstract handle(message: InboundMessage): Promise<void>;

  // Preparacao antes de conectar (ex.: garantir topicos). Falha aqui segue o
  // mesmo caminho de falha de conexao: consumer degradado e nova tentativa.
  protected async beforeStart(): Promise<void> {}

  // Nao bloqueia o bootstrap: broker fora na subida deixa o consumer
  // degradado (visivel no health) e tentando de novo, sem derrubar a app.
  onApplicationBootstrap(): void {
    this.scheduleStart(0, 0);
  }

  getHealth(): ConsumerHealth {
    return this.health;
  }

  // disconnect para o fetch e aguarda o eachMessage em andamento terminar.
  async onModuleDestroy(): Promise<void> {
    this.isStopping = true;
    if (this.startTimer) clearTimeout(this.startTimer);
    await this.startAttempt;
    await this.consumer?.disconnect();
    this.consumer = null;
    this.setStatus("stopped");
  }

  private scheduleStart(delayMs: number, attempt: number): void {
    this.startTimer = setTimeout((): void => {
      this.startTimer = null;
      // start nunca rejeita (falhas viram novo agendamento).
      this.startAttempt = this.start(attempt).finally((): void => {
        this.startAttempt = null;
      });
    }, delayMs);
  }

  private async start(attempt: number): Promise<void> {
    if (this.isStopping) return;

    const { groupId, topics, fromBeginning, retry } = this.subscription;
    const consumer = this.kafka.consumer({
      groupId,
      retry: {
        retries: retry.retries,
        initialRetryTime: retry.initialRetryTimeMs,
        maxRetryTime: retry.maxRetryTimeMs,
        // Esgotado o retry, o KafkaJS crasha o consumer e o reinicia (o
        // offset da mensagem com falha nao foi commitado: ela volta).
        restartOnFailure: async (): Promise<boolean> => true,
      },
    });
    this.consumer = consumer;

    consumer.on(consumer.events.GROUP_JOIN, (): void => {
      if (this.health.status === "starting") this.setStatus("running");
    });
    consumer.on(consumer.events.CRASH, ({ payload }): void => {
      this.logger.error("Consumer Kafka crashou", payload.error, {
        groupId,
        restart: payload.restart,
      });
      this.setStatus("degraded", payload.error.message);
      // Sem restart automatico (erro nao retentavel do KafkaJS): recria o
      // consumer por conta propria.
      if (!payload.restart && !this.isStopping) {
        void this.recreate(attempt + 1);
      }
    });

    try {
      await this.beforeStart();
      await consumer.connect();
      await consumer.subscribe({ topics: [...topics], fromBeginning });

      // autoCommit so resolve o offset depois que eachMessage retorna: erro
      // lancado pelo handler => offset nao commitado => KafkaJS reprocessa.
      await consumer.run({
        autoCommit: true,
        eachMessage: async ({ topic, partition, message }): Promise<void> => {
          const inbound = toInboundMessage(topic, partition, message);
          await runWithCorrelationId(
            resolveCorrelationId(inbound.headers[EVENT_HEADERS.correlationId]),
            () => this.handle(inbound),
          );
          if (this.health.status !== "running") this.setStatus("running");
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error("Falha ao iniciar consumer Kafka", error, {
        groupId,
        attempt,
      });
      this.setStatus("degraded", error.message);
      await this.recreate(attempt + 1);
    }
  }

  private async recreate(attempt: number): Promise<void> {
    const previous = this.consumer;
    this.consumer = null;
    await previous?.disconnect().catch((): void => undefined);
    if (this.isStopping) return;
    this.scheduleStart(startBackoffMs(attempt), attempt);
  }

  private setStatus(status: ConsumerStatus, lastError?: string): void {
    this.health = { status, since: new Date(), lastError };
  }
}

function startBackoffMs(attempt: number): number {
  return Math.min(START_BACKOFF_BASE_MS * 2 ** attempt, MAX_START_BACKOFF_MS);
}

export function toInboundMessage(
  topic: string,
  partition: number,
  message: KafkaMessage,
): InboundMessage {
  return {
    topic,
    partition,
    offset: message.offset,
    timestamp: message.timestamp,
    key: message.key?.toString() ?? null,
    value: message.value,
    headers: decodeHeaders(message.headers),
  };
}

function decodeHeaders(headers: IHeaders | undefined): Record<string, string> {
  const decoded: Record<string, string> = {};
  for (const [name, raw] of Object.entries(headers ?? {})) {
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (first !== undefined) decoded[name] = first.toString();
  }
  return decoded;
}
