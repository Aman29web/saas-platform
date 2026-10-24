import { AsyncLocalStorage } from "async_hooks";
import type { Role } from "../common/enums";

export interface TenantContextData {
  tenantId: string;
  userId: string;
  role: Role;
  impersonatorId?: string;
}

const storage = new AsyncLocalStorage<TenantContextData>();

export const TenantContext = {
  /**
   * Runs `fn` with the tenant context scoped for its entire call tree,
   * including everything it awaits. Used by TenantContextInterceptor to
   * wrap the actual handler invocation.
   *
   * Deliberately NOT `enterWith()`: Nest bridges a guard's resolved
   * canActivate() into the handler invocation through an RxJS Observable
   * subscription, which runs as a new continuation rather than a direct
   * continuation of the guard's own promise chain. enterWith() only affects
   * the calling continuation, so context set in a guard is invisible by the
   * time the controller/service actually runs. AsyncLocalStorage.run()
   * explicitly brackets the scope around the callback instead of relying on
   * "whatever the current continuation happens to be," so it survives that
   * boundary.
   */
  run<T>(data: TenantContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  get(): TenantContextData | undefined {
    return storage.getStore();
  },

  getTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  },
};
