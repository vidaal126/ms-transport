import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Kafka } from "kafkajs";
import { runWithCorrelationId } from "@common/correlation/correlation-context";
import { type ILogger, LOGGER_TOKEN } from "@common/logger/logger.interface";
import { type Env, readEnv } from "@config/env";
import { InvariantViolationError } from "@domain/errors/domain.error";
import { DeadLetterPublisher } from "@infrastructure/messaging/dead-letter.publisher";
import {
  type ConsumerSubscription,
  type InboundMessage,
  KafkaConsumerBase,
} from "@infrastructure/messaging/kafka-consumer.base";
import { KAFKA_CLIENT } from "@infrastructure/messaging/kafka.tokens";
import {
  type CatalogItemEvent,
  SyncCatalogItemUseCase,
} from "@application/use-cases/sync-catalog-item.use-case";
import { decodeCatalogItemCreated } from "./catalog-item-created.decoder";

export const CATALOG_ITEM_CREATED_TOPIC = "catalog.ItemCreated";
// Grupo novo com fromBeginning: o read model e construido a partir do
// historico do topico (replay).
export const CATALOG_ITEMS_GROUP_ID = "ms-transport.catalog-items";

// Adapter de entrada: classifica o resultado de cada mensagem.
// - nao recuperavel (JSON invalido, schema, versao nao suportada, invariante
//   de dominio): DLT com payload original e retorna => offset commitado;
// - recuperavel (banco, timeout, qualquer erro nao classificado): lanca =>
//   offset nao commitado, retry do KafkaJS e, esgotado, restart do consumer.
@Injectable()
export class CatalogItemCreatedConsumer extends KafkaConsumerBase {
  protected readonly subscription: ConsumerSubscription;

  constructor(
    @Inject(KAFKA_CLIENT) kafka: Kafka,
    @Inject(LOGGER_TOKEN) logger: ILogger,
    private readonly syncCatalogItem: SyncCatalogItemUseCase,
    private readonly deadLetter: DeadLetterPublisher,
    config: ConfigService<Env, true>,
  ) {
    super(kafka, logger);
    this.subscription = {
      groupId: CATALOG_ITEMS_GROUP_ID,
      topics: [CATALOG_ITEM_CREATED_TOPIC],
      fromBeginning: true,
      retry: {
        retries: readEnv(config, "CONSUMER_RETRY_RETRIES"),
        initialRetryTimeMs: readEnv(config, "CONSUMER_RETRY_INITIAL_MS"),
        maxRetryTimeMs: readEnv(config, "CONSUMER_RETRY_MAX_MS"),
      },
    };
  }

  protected override async beforeStart(): Promise<void> {
    await this.deadLetter.ensureTopic(CATALOG_ITEM_CREATED_TOPIC);
  }

  protected async handle(message: InboundMessage): Promise<void> {
    const decoded = decodeCatalogItemCreated(message.value);
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
      if (outcome === "duplicate") {
        this.logger.debug("Evento ja processado, ignorado", context);
      } else {
        this.logger.log("Evento de catalogo aplicado ao read model", context);
      }
    } catch (err) {
      if (err instanceof InvariantViolationError) {
        await this.deadLetter.publish(message, "domain_invariant_violation", err.message);
        return;
      }
      this.logger.error(
        "Falha recuperavel ao processar evento de catalogo; offset nao sera commitado",
        err instanceof Error ? err : new Error(String(err)),
        { ...position, eventId: event.eventId },
      );
      throw err;
    }
  }
}
