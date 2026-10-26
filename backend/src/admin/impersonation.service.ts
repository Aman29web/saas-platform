import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { UsersService } from "../users/users.service";
import { MembershipsService } from "../memberships/memberships.service";
import { TokensService } from "../auth/tokens.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { TenantContext } from "../tenancy/tenant-context";

const IMPERSONATION_TOKEN_TTL = "15m";

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly usersService: UsersService,
    private readonly membershipsService: MembershipsService,
    private readonly tokensService: TokensService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Impersonation is scoped to a specific org, not just a user: the admin
   * is choosing "show me what this user sees in this org," which lets
   * every existing guard/permission/tenant-context mechanism work
   * unmodified for the duration — the impersonation token's `sub` IS the
   * target user, so TenantContextGuard resolves their real membership and
   * role exactly as it would for the user themself.
   */
  async startImpersonation(
    adminId: string,
    adminAccessToken: string,
    targetUserId: string,
    orgId: string,
    ip?: string,
  ) {
    const targetUser = await this.usersService.findById(targetUserId);
    if (!targetUser) throw new NotFoundException("Target user not found");

    const membership = await this.membershipsService.findOne(targetUserId, orgId);
    if (!membership) throw new NotFoundException("Target user is not a member of this organization");

    const impersonationAccessToken = await this.tokensService.signAccessToken(
      { sub: targetUserId, email: targetUser.email, impersonatorId: adminId },
      IMPERSONATION_TOKEN_TTL,
    );

    await TenantContext.run(
      { tenantId: orgId, userId: targetUserId, role: membership.role, impersonatorId: adminId, ip },
      () =>
        this.auditLogService.record("impersonation.started", "user", targetUserId, {
          targetEmail: targetUser.email,
        }),
    );

    return { impersonationAccessToken, adminAccessToken, orgId, targetEmail: targetUser.email };
  }

  async endImpersonation(adminAccessTokenCookie: string | undefined, orgId: string | undefined, ip?: string) {
    if (!adminAccessTokenCookie) {
      throw new UnauthorizedException("Not currently impersonating — no admin session to restore");
    }

    let adminPayload;
    try {
      adminPayload = await this.tokensService.verifyAccessToken(adminAccessTokenCookie);
    } catch {
      throw new UnauthorizedException("Stored admin session has expired — please log in again");
    }
    if (adminPayload.impersonatorId) {
      // Defensive: the stashed cookie should never itself be an
      // impersonation token, but refuse to chain impersonation sessions.
      throw new ForbiddenException("Cannot restore an impersonation token as the admin session");
    }

    if (orgId) {
      // role is a neutral placeholder here, not an isolation decision —
      // this call only ever writes an audit entry, never a scoped query.
      await TenantContext.run({ tenantId: orgId, userId: adminPayload.sub, role: "member", ip }, () =>
        this.auditLogService.record("impersonation.ended", "user", adminPayload.sub),
      ).catch(() => undefined); // best-effort: the admin may not even be a member of this org
    }

    return adminAccessTokenCookie;
  }
}
