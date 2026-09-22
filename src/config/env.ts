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

  RABBITMQ_URL: z
    .string()
    .regex(/^amqps?:\/\//, "deve ser uma URL amqp://")
    .default("amqp://guest:guest@localhost:5672"),
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
