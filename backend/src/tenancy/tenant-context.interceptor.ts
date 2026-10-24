import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { TenantContext } from "./tenant-context";
import type { TenantScopedRequest } from "./tenant-context.guard";

/**
 * Must run on routes guarded by TenantContextGuard. Reads the context that
 * guard attached to the request and scopes it with AsyncLocalStorage.run()
 * around the actual handler invocation, so every Mongoose query/save the
 * handler triggers (directly or through a service) sees it.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    const ctx = request.tenantContext;

    if (!ctx) {
      throw new Error(
        "TenantContextInterceptor ran without a resolved tenantContext — is TenantContextGuard applied on this route?",
      );
    }

    return new Observable((subscriber) => {
      TenantContext.run(ctx, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
