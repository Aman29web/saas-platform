import { Module } from "@nestjs/common";
import { MembershipsController } from "./memberships.controller";
import { MembershipsModule } from "./memberships.module";
import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { UsersModule } from "../users/users.module";
import { AuditLogModule } from "../audit-log/audit-log.module";

/**
 * Separate from MembershipsModule specifically to avoid a circular import:
 * AuthModule and TenancyModule both already depend on MembershipsModule
 * (for the Membership model itself), so MembershipsModule cannot also
 * depend on them for TenantContextGuard's DI requirements. This module
 * sits on top of all three instead.
 */
@Module({
  imports: [MembershipsModule, AuthModule, TenancyModule, UsersModule, AuditLogModule],
  controllers: [MembershipsController],
})
export class OrgMembersModule {}
