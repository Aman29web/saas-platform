import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { TenantContextGuard } from "../tenancy/tenant-context.guard";
import { TenantContextInterceptor } from "../tenancy/tenant-context.interceptor";
import { RequirePermission } from "../rbac/require-permission.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { InvitationsService } from "./invitations.service";
import { inviteMemberSchema, type InviteMemberDto } from "./dto/invitation.dto";
import type { ApiEnv } from "../config/env.schema";

@Controller("invitations")
@UseGuards(TenantContextGuard)
@UseInterceptors(TenantContextInterceptor)
export class InvitationsController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @RequirePermission("members:invite")
  invite(@Body(new ZodValidationPipe(inviteMemberSchema)) dto: InviteMemberDto) {
    return this.invitationsService.invite(dto, this.config.get("WEB_APP_URL", { infer: true }));
  }

  @Get()
  @RequirePermission("members:invite")
  listPending() {
    return this.invitationsService.listPending();
  }

  @Post(":id/resend")
  @RequirePermission("members:invite")
  resend(@Param("id") id: string) {
    return this.invitationsService.resend(id, this.config.get("WEB_APP_URL", { infer: true }));
  }

  @Delete(":id")
  @RequirePermission("members:remove")
  @HttpCode(204)
  async revoke(@Param("id") id: string) {
    await this.invitationsService.revoke(id);
  }
}
