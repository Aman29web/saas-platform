import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, UseGuards, UseInterceptors } from "@nestjs/common";
import { TenantContextGuard } from "../tenancy/tenant-context.guard";
import { TenantContextInterceptor } from "../tenancy/tenant-context.interceptor";
import { RequirePermission } from "../rbac/require-permission.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { MembershipsService } from "./memberships.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { TenantContext } from "../tenancy/tenant-context";
import { changeRoleSchema, type ChangeRoleDto } from "./dto/membership.dto";

@Controller("memberships")
@UseGuards(TenantContextGuard)
@UseInterceptors(TenantContextInterceptor)
export class MembershipsController {
  constructor(
    private readonly membershipsService: MembershipsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  list() {
    const ctx = TenantContext.get()!;
    return this.membershipsService.listForOrg(ctx.tenantId);
  }

  @Patch(":userId/role")
  @RequirePermission("members:role:change")
  async changeRole(@Param("userId") userId: string, @Body(new ZodValidationPipe(changeRoleSchema)) dto: ChangeRoleDto) {
    const ctx = TenantContext.get()!;
    const result = await this.membershipsService.updateRole(ctx.tenantId, userId, dto.role);
    if (result === "cannot_change_owner") throw new ConflictException("Cannot change the owner's role");
    if (!result) throw new ConflictException("Membership not found");

    await this.auditLogService.record("membership.role_changed", "membership", userId, { newRole: dto.role });
    return result;
  }

  @Delete(":userId")
  @RequirePermission("members:remove")
  @HttpCode(204)
  async remove(@Param("userId") userId: string) {
    const ctx = TenantContext.get()!;
    const result = await this.membershipsService.remove(ctx.tenantId, userId);
    if (result === "cannot_remove_owner") throw new ConflictException("Cannot remove the owner");
    if (!result) throw new ConflictException("Membership not found");

    await this.auditLogService.record("membership.removed", "membership", userId);
  }
}
