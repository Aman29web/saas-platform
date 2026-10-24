import { AsyncLocalStorage } from "async_hooks";
import { Logger } from "@nestjs/common";

export interface TenantBypassContext {
  actorId: string;
  reason: string;
}

const storage = new AsyncLocalStorage<TenantBypassContext>();
const logger = new Logger("TenantBypass");

/**
 * The explicit, logged escape hatch for cross-tenant queries. Every call is
 * logged with the acting platform admin and a reason BEFORE the query runs.
 * Only code that has already verified the caller is a platform admin
 * (see PlatformAdminGuard) should ever call this.
 */
export function runAsTenantBypass<T>(ctx: TenantBypassContext, fn: () => Promise<T> | T): Promise<T> | T {
  logger.warn({ actorId: ctx.actorId, reason: ctx.reason }, "cross-tenant query bypass");
  return storage.run(ctx, fn);
}

export function getTenantBypassContext(): TenantBypassContext | undefined {
  return storage.getStore();
}
