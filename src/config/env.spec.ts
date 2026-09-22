import { InvalidEnvironmentError, validateEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5435/db",
  KAFKA_BROKER: "localhost:9092",
};

describe("validateEnv", () => {
  it("aplica defaults e converte tipos", () => {
    const env = validateEnv({ ...valid, PORT: "4001" });

    expect(env.PORT).toBe(4001);
    expect(env.RABBITMQ_URL).toBe("amqp://guest:guest@localhost:5672");
    expect(env.KAFKA_BROKER).toEqual(["localhost:9092"]);
  });

  it("falha listando todas as variaveis invalidas", () => {
    const attempt = (): unknown =>
      validateEnv({ RABBITMQ_URL: "http://x", PORT: "abc", KAFKA_BROKER: "sem-porta" });

    expect(attempt).toThrow(InvalidEnvironmentError);
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).toThrow(/RABBITMQ_URL/);
    expect(attempt).toThrow(/PORT/);
    expect(attempt).toThrow(/KAFKA_BROKER/);
  });
});
