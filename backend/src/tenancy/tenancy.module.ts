import { Global, Module } from "@nestjs/common";
import { TenantContextGuard } from "./tenant-context.guard";
import { TenantContextInterceptor } from "./tenant-context.interceptor";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { MembershipsModule } from "../memberships/memberships.module";
import { UsersModule } from "../users/users.module";
import { AuthModule } from "../auth/auth.module";

// Global for the same reason as AuthModule: these guards are used via
// @UseGuards(...) in every tenant-owned module's controllers.
@Global()
@Module({
  imports: [MembershipsModule, UsersModule, AuthModule],
  providers: [TenantContextGuard, TenantContextInterceptor, PlatformAdminGuard],
  exports: [TenantContextGuard, TenantContextInterceptor, PlatformAdminGuard],
})
export class TenancyModule {}
