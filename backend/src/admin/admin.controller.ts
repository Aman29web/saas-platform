import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedUser } from "../auth/auth.guard";
import { PlatformAdminGuard } from "../tenancy/platform-admin.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { runAsTenantBypass } from "../tenancy/tenant-bypass";
import { ProjectsAdminService } from "./projects-admin.service";

@Controller("admin")
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(private readonly projectsAdminService: ProjectsAdminService) {}

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
}
