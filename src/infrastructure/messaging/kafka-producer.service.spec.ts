import type { ConfigService } from "@nestjs/config";
import type { Kafka, Producer } from "kafkajs";
import type { ILogger } from "@common/logger/logger.interface";
import { TimeoutError } from "@common/with-timeout";
import { KafkaProducerService } from "./kafka-producer.service";

const silentLogger: ILogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

type ProducerConfig = ConfigService<{ KAFKA_SEND_TIMEOUT_MS: number }, true>;

const message = {
  topic: "transport.TransportTypeCreated",
  key: "agg-1",
  value: "{}",
  headers: {},
};

// Producer cujo send nunca termina: simula o kafkajs preso em retries
// ilimitados com o broker fora.
function kafkaWithStuckSend(): Kafka {
  const producer: Pick<Producer, "on" | "events" | "connect" | "send" | "disconnect"> = {
    on: () => () => undefined,
    events: { DISCONNECT: "producer.disconnect" } as Producer["events"],
    connect: async (): Promise<void> => undefined,
    send: () => new Promise<never>(() => undefined),
    disconnect: async (): Promise<void> => undefined,
  };
  const kafka: Pick<Kafka, "producer"> = {
    producer: () => producer as Producer,
  };
  return kafka as Kafka;
}

describe("KafkaProducerService timeout", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("rejeita com TimeoutError quando o envio passa de KAFKA_SEND_TIMEOUT_MS", async () => {
    const config: Pick<ProducerConfig, "get"> = { get: () => 100 };
    const service = new KafkaProducerService(
      kafkaWithStuckSend(),
      silentLogger,
      config as ProducerConfig,
    );

    const sending = service.send(message);
    const assertion = expect(sending).rejects.toBeInstanceOf(TimeoutError);
    await jest.advanceTimersByTimeAsync(100);

    await assertion;
  });
});
