import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../auth/auth.guard";

/**
 * Gates any endpoint that uses the tenant-isolation escape hatch
 * (runAsTenantBypass). Must run AFTER AuthGuard.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    if (!request.user?.isPlatformAdmin) {
      throw new ForbiddenException("Platform admin access required");
    }
    return true;
  }
}
