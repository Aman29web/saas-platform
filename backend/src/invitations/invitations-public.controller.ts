import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { AuthGuard, type AuthenticatedUser } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { InvitationsService } from "./invitations.service";
import { acceptInviteSchema, type AcceptInviteDto } from "./dto/invitation.dto";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * Separate from InvitationsController deliberately: these routes run
 * before the caller has any org membership, so none of them can use
 * TenantContextGuard (it requires X-Org-Id + an existing membership).
 * GET is public — anyone with the link can preview the invite without
 * being logged in, to decide whether to sign up or log in first.
 */
@Controller("invitations/public")
export class InvitationsPublicController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(":token")
  async preview(@Param("token") token: string) {
    const invitation = await this.invitationsService.findByRawToken(token);
    if (!invitation) throw new NotFoundException("Invitation not found or already used");

    const org = await this.organizationsService.findById(invitation.tenantId);
    return {
      email: invitation.email,
      role: invitation.role,
      orgName: org?.name,
      expired: invitation.expiresAt.getTime() < Date.now(),
      revoked: Boolean(invitation.revokedAt),
      accepted: Boolean(invitation.acceptedAt),
    };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("accept")
  @UseGuards(AuthGuard)
  accept(
    @Body(new ZodValidationPipe(acceptInviteSchema)) dto: AcceptInviteDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.invitationsService.accept(dto.token, user, req.ip);
  }
}
