import { Module } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { DeadLetterPublisher } from "./dead-letter.publisher";
import { KafkaClientFactory } from "./kafka-client.factory";
import { KafkaProducerService } from "./kafka-producer.service";
import { KAFKA_CLIENT } from "./kafka.tokens";

// Modulo autocontido (config Kafka, client, producer, base de consumer,
// DLT e envelope), copia do mesmo modulo do ms-catalog. Depende apenas de @common
// e das variaveis KAFKA_BROKER e KAFKA_CLIENT_ID do servico.
@Module({
  providers: [
    KafkaClientFactory,
    {
      provide: KAFKA_CLIENT,
      useFactory: (factory: KafkaClientFactory): Kafka => factory.create(),
      inject: [KafkaClientFactory],
    },
    KafkaProducerService,
    DeadLetterPublisher,
  ],
  exports: [KAFKA_CLIENT, KafkaProducerService, DeadLetterPublisher],
})
export class MessagingModule {}
