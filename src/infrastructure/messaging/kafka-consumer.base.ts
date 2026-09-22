import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { Consumer, IHeaders, Kafka, KafkaMessage } from "kafkajs";
import { runWithCorrelationId } from "@common/correlation/correlation-context";
import { resolveCorrelationId } from "@common/correlation/correlation-id";
import { EVENT_HEADERS } from "./event-envelope";

export interface ConsumerSubscription {
  readonly groupId: string;
  readonly topics: readonly string[];
  readonly fromBeginning: boolean;
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

// Base para consumers: conexao, subscribe, contexto de log com correlationId
// e desligamento. Politica de erro (retry, DLT) fica no handler concreto.
export abstract class KafkaConsumerBase
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private consumer: Consumer | null = null;

  protected constructor(private readonly kafka: Kafka) {}

  protected abstract readonly subscription: ConsumerSubscription;

  protected abstract handle(message: InboundMessage): Promise<void>;

  async onApplicationBootstrap(): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId: this.subscription.groupId,
    });
    this.consumer = consumer;

    await consumer.connect();
    await consumer.subscribe({
      topics: [...this.subscription.topics],
      fromBeginning: this.subscription.fromBeginning,
    });

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
      },
    });
  }

  // disconnect para o fetch e aguarda o eachMessage em andamento terminar.
  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
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
