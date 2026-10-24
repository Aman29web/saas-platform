import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { MembershipsService } from "../memberships/memberships.service";
import { UsersService } from "../users/users.service";
import { TokensService } from "../auth/tokens.service";
import type { TenantContextData } from "./tenant-context";
import type { AuthenticatedUser } from "../auth/auth.guard";

export type TenantScopedRequest = Request & { user: AuthenticatedUser; tenantContext: TenantContextData };

/**
 * Authenticates the request and resolves which organization it operates on,
 * rejecting (401/400/403) before the handler ever runs. This guard only
 * VALIDATES and attaches the result to `request.tenantContext` — it does
 * NOT establish the AsyncLocalStorage scope itself (see tenant-context.ts
 * for why). TenantContextInterceptor does that, downstream.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly tokensService: TokensService,
    private readonly usersService: UsersService,
    private readonly membershipsService: MembershipsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();

    const accessToken = request.cookies?.access_token as string | undefined;
    if (!accessToken) throw new UnauthorizedException("Missing access token");

    let payload;
    try {
      payload = await this.tokensService.verifyAccessToken(accessToken);
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException("User no longer exists");

    request.user = { id: user._id.toString(), email: user.email, isPlatformAdmin: user.isPlatformAdmin };

    const orgId = request.headers["x-org-id"];
    if (!orgId || typeof orgId !== "string") {
      throw new BadRequestException("Missing X-Org-Id header");
    }

    const membership = await this.membershipsService.findOne(request.user.id, orgId);
    if (!membership) {
      throw new ForbiddenException("You are not a member of this organization");
    }

    request.tenantContext = {
      tenantId: orgId,
      userId: request.user.id,
      role: membership.role,
    };

    return true;
  }
}
