import type { ExecutionContext } from "@nestjs/common";
import { HttpThrottlerGuard } from "./http-throttler.guard";

// Expoe o hook protegido para teste.
class TestableGuard extends HttpThrottlerGuard {
  skip(context: ExecutionContext): Promise<boolean> {
    return this.shouldSkip(context);
  }
}

function contextOfType(type: "http" | "rpc"): ExecutionContext {
  const context: Pick<ExecutionContext, "getType"> = {
    getType: <T extends string>() => type as T,
  };
  return context as ExecutionContext;
}

describe("HttpThrottlerGuard", () => {
  const guard = Object.create(TestableGuard.prototype) as TestableGuard;

  it("ignora contexto RPC (microservico RabbitMQ)", async () => {
    await expect(guard.skip(contextOfType("rpc"))).resolves.toBe(true);
  });
});
