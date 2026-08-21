import type { IncomingMessage, ServerResponse } from "node:http";
import { Global, Module, RequestMethod } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { LOGGER_TOKEN } from "./logger.interface";
import { PinoLoggerService } from "./pino-logger.service";

type ExpressLike = IncomingMessage & { route?: { path?: string } };

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        forRoutes: [{ path: "*", method: RequestMethod.ALL }],
        pinoHttp: {
          level: config.get<string>("LOG_LEVEL", "info"),
          transport:
            config.get<string>("NODE_ENV") !== "production"
              ? { target: "pino-pretty", options: { singleLine: true } }
              : undefined,
          customAttributeKeys: { responseTime: "duration" },
          customLogLevel: (
            _req: IncomingMessage,
            res: ServerResponse,
            err: Error | undefined,
          ): "error" | "warn" | "info" => {
            if (res.statusCode >= 500 || err) return "error";
            if (res.statusCode >= 400) return "warn";
            return "info";
          },
          serializers: {
            req: (): Record<string, never> => ({}),
            res: (): Record<string, never> => ({}),
          },
          customProps: (req: IncomingMessage): Record<string, unknown> => {
            const r = req as ExpressLike;
            return { route: r.route?.path ?? req.url };
          },
          redact: {
            paths: ["req", "res"],
            remove: true,
          },
        },
      }),
    }),
  ],
  providers: [{ provide: LOGGER_TOKEN, useClass: PinoLoggerService }],
  exports: [LOGGER_TOKEN],
})
export class LoggerModule {}
