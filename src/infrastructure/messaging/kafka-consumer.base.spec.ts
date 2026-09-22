import type { KafkaMessage } from "kafkajs";
import { toInboundMessage } from "./kafka-consumer.base";

describe("toInboundMessage", () => {
  it("decodifica key e headers e preserva o valor bruto", () => {
    const value = Buffer.from("{isto nao e json");
    const message: KafkaMessage = {
      key: Buffer.from("agg-1"),
      value,
      timestamp: "1700000000000",
      attributes: 0,
      offset: "42",
      headers: {
        correlationId: Buffer.from("corr-1"),
        schemaVersion: "2",
        multi: [Buffer.from("first"), Buffer.from("second")],
        missing: undefined,
      },
    };

    const inbound = toInboundMessage("catalog.ItemCreated", 0, message);

    expect(inbound).toEqual({
      topic: "catalog.ItemCreated",
      partition: 0,
      offset: "42",
      timestamp: "1700000000000",
      key: "agg-1",
      value,
      headers: { correlationId: "corr-1", schemaVersion: "2", multi: "first" },
    });
  });
});
