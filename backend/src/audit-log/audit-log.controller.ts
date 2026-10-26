import { Controller, Get, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { TenantContextGuard } from "../tenancy/tenant-context.guard";
import { TenantContextInterceptor } from "../tenancy/tenant-context.interceptor";
import { RequirePermission } from "../rbac/require-permission.decorator";
import { AuditLogService } from "./audit-log.service";

@Controller("audit-log")
@UseGuards(TenantContextGuard)
@UseInterceptors(TenantContextInterceptor)
@RequirePermission("audit:view")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  list(@Query("action") action?: string, @Query("actorId") actorId?: string) {
    return this.auditLogService.findForActiveOrg({ action, actorId });
  }
}
