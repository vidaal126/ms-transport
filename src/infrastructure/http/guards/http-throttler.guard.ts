import { type ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

// APP_GUARD tambem se aplica aos handlers do microservico RabbitMQ (app
// hibrida). O ThrottlerGuard assume contexto HTTP; em RPC ele quebraria o
// handler, entao o rate limit vale so para HTTP.
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    return super.shouldSkip(context);
  }
}
