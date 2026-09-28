import type { ConfigService } from "@nestjs/config";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "deve ser uma URL postgresql://"),

  // Lista separada por virgula: "host1:9092,host2:9092".
  KAFKA_BROKER: z
    .string()
    .min(1)
    .transform((value) => value.split(",").map((broker) => broker.trim()))
    .pipe(z.array(z.string().regex(/^[^\s:]+:\d+$/, "formato host:porta")).min(1)),
  KAFKA_CLIENT_ID: z.string().min(1).default("ms-transport"),
  // Group do sync do catalogo. Sobrescrever so para replay com um group
  // temporario (fixo por execucao, nunca aleatorio): o group principal segue
  // intacto e a idempotencia torna o replay seguro.
  CATALOG_SYNC_GROUP_ID: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,249}$/, "group id Kafka invalido")
    .default("ms-transport.catalog-item-sync"),
  // Falha recuperavel (banco, timeout, conexao): retry em processo com backoff
  // exponencial e jitter, sem commitar. Esgotado, pausa a particao por
  // CONSUMER_PAUSE_MS e retoma da mesma mensagem.
  CONSUMER_RETRY_RETRIES: z.coerce.number().int().min(0).default(5),
  CONSUMER_RETRY_INITIAL_MS: z.coerce.number().int().positive().default(300),
  CONSUMER_RETRY_MAX_MS: z.coerce.number().int().positive().default(30_000),
  CONSUMER_PAUSE_MS: z.coerce.number().int().positive().default(30_000),

  // Outbox dos eventos transport.TransportType*.
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(1_000).default(20),

  THROTTLE_DEFAULT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().positive().default(100),

  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(1_500),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvironmentError extends Error {}

// Usado pelo ConfigModule.validate: falha no bootstrap, antes de qualquer
// modulo instanciar conexoes, com a lista completa de problemas.
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      `Variaveis de ambiente invalidas:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

// ConfigService.get(key, { infer: true }) infere o retorno pelo contexto
// (overload generico): atribuir a um campo de outro tipo compila sem erro.
// readEnv fixa o retorno em Env[K], o tipo validado pelo schema.
export function readEnv<K extends keyof Env>(
  config: ConfigService<Env, true>,
  key: K,
): Env[K] {
  return config.get(key, { infer: true });
}
