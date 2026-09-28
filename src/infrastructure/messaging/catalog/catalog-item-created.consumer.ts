import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Kafka } from "kafkajs";
import { runWithCorrelationId } from "@common/correlation/correlation-context";
import { type ILogger, LOGGER_TOKEN } from "@common/logger/logger.interface";
import { type Env, readEnv } from "@config/env";
import { DEAD_LETTER_PORT, type DeadLetterPort } from "@application/ports/dead-letter.port";
import {
  type CatalogItemEvent,
  SYNC_CATALOG_ITEM,
  type SyncCatalogItemPort,
} from "@application/ports/sync-catalog-item.port";
import { InvariantViolationError } from "@domain/errors/domain.error";
import {
  type ConsumerSubscription,
  type InboundMessage,
  KafkaConsumerBase,
} from "@infrastructure/messaging/kafka-consumer.base";
import { KAFKA_CLIENT } from "@infrastructure/messaging/kafka.tokens";
import { decodeCatalogItemCreated } from "./catalog-item-created.decoder";

export const CATALOG_ITEM_CREATED_TOPIC = "catalog.ItemCreated";
// Adapter de entrada: classifica o resultado de cada mensagem.
// - nao recuperavel (JSON invalido, schema, versao nao suportada, invariante
//   de dominio, incluindo dado rejeitado pelo banco): DLT com payload
//   original e retorna => offset commitado depois do ack da DLT;
// - recuperavel (banco, timeout, conexao, qualquer erro nao classificado):
//   lanca => sem commit; a base faz retry com backoff e depois pausa a
//   particao. Nunca pula a mensagem.
// Group (CATALOG_SYNC_GROUP_ID) com fromBeginning: sem offset commitado, le o
// topico inteiro e constroi o read model.
@Injectable()
export class CatalogItemCreatedConsumer extends KafkaConsumerBase {
  protected readonly subscription: ConsumerSubscription;

  constructor(
    @Inject(KAFKA_CLIENT) kafka: Kafka,
    @Inject(LOGGER_TOKEN) logger: ILogger,
    @Inject(SYNC_CATALOG_ITEM) private readonly syncCatalogItem: SyncCatalogItemPort,
    @Inject(DEAD_LETTER_PORT) private readonly deadLetter: DeadLetterPort,
    config: ConfigService<Env, true>,
  ) {
    super(kafka, logger);
    this.subscription = {
      groupId: readEnv(config, "CATALOG_SYNC_GROUP_ID"),
      topics: [CATALOG_ITEM_CREATED_TOPIC],
      fromBeginning: true,
      retry: {
        retries: readEnv(config, "CONSUMER_RETRY_RETRIES"),
        initialDelayMs: readEnv(config, "CONSUMER_RETRY_INITIAL_MS"),
        maxDelayMs: readEnv(config, "CONSUMER_RETRY_MAX_MS"),
        pauseMs: readEnv(config, "CONSUMER_PAUSE_MS"),
      },
    };
  }

  protected override async beforeStart(): Promise<void> {
    await this.deadLetter.ensureTopic(CATALOG_ITEM_CREATED_TOPIC);
  }

  protected async handle(message: InboundMessage): Promise<void> {
    const decoded = decodeCatalogItemCreated(message.value, message);
    if (!decoded.ok) {
      await this.deadLetter.publish(message, decoded.reason, decoded.detail);
      return;
    }

    // O correlationId do envelope prevalece sobre o do header (ou o gerado
    // quando nao ha header) nos logs do processamento.
    const { event, correlationId } = decoded;
    if (correlationId !== undefined) {
      await runWithCorrelationId(correlationId, () => this.apply(message, event));
      return;
    }
    await this.apply(message, event);
  }

  private async apply(message: InboundMessage, event: CatalogItemEvent): Promise<void> {
    const position = {
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
    };

    try {
      const outcome = await this.syncCatalogItem.execute(event);
      const context = { ...position, eventId: event.eventId, itemId: event.itemId, outcome };
      switch (outcome) {
        case "applied":
          this.logger.log("Evento de catalogo processado no read model", context);
          return;
        case "duplicate":
          this.logger.debug("Evento ja processado, ignorado", context);
          return;
        case "stale":
          // Mais antigo que a versao gravada (reordenacao/replay): descartado.
          this.logger.debug("Evento mais antigo que o read model, ignorado", context);
          return;
      }
    } catch (err) {
      if (err instanceof InvariantViolationError) {
        await this.deadLetter.publish(message, "domain_invariant_violation", err.message);
        return;
      }
      // Sem log aqui: a base registra cada tentativa e a pausa.
      throw err;
    }
  }
}
