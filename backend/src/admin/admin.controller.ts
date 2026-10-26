import { Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { AuthGuard, type AuthenticatedUser } from "../auth/auth.guard";
import { PlatformAdminGuard } from "../tenancy/platform-admin.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { runAsTenantBypass } from "../tenancy/tenant-bypass";
import { ProjectsAdminService } from "./projects-admin.service";
import { ImpersonationService } from "./impersonation.service";
import { setImpersonationCookies } from "../auth/cookies";
import type { ApiEnv } from "../config/env.schema";

@Controller("admin")
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly projectsAdminService: ProjectsAdminService,
    private readonly impersonationService: ImpersonationService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  /**
   * Cross-tenant read for platform support/ops. Gated to platform admins by
   * PlatformAdminGuard, and every call is logged by runAsTenantBypass before
   * the query runs (see tenancy/tenant-bypass.ts).
   */
  @Get("projects")
  async listAllProjects(@CurrentUser() admin: AuthenticatedUser) {
    return runAsTenantBypass({ actorId: admin.id, reason: "admin:list-all-projects" }, () =>
      this.projectsAdminService.findAllAcrossTenants(),
    );
  }

  /**
   * Starting impersonation is gated normally (AuthGuard + PlatformAdminGuard
   * check the admin's OWN active session) because at this point the active
   * cookie really is the admin's. Ending it is NOT on this controller — see
   * ImpersonationExitController for why gating that the same way is wrong.
   */
  @Post("impersonate/:userId/:orgId")
  @HttpCode(200)
  async impersonate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param("userId") userId: string,
    @Param("orgId") orgId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const adminAccessToken = req.cookies?.access_token as string | undefined;
    if (!adminAccessToken) throw new Error("PlatformAdminGuard ran without an access token — this should be unreachable");

    const result = await this.impersonationService.startImpersonation(
      admin.id,
      adminAccessToken,
      userId,
      orgId,
      req.ip,
    );

    setImpersonationCookies(res, this.config, {
      adminAccessToken: result.adminAccessToken,
      impersonationAccessToken: result.impersonationAccessToken,
    });

    return { orgId: result.orgId, impersonating: result.targetEmail };
  }
}
