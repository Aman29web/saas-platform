import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Invitation, InvitationDocument } from "./schemas/invitation.schema";
import { generateInviteToken, hashToken } from "./token";
import { TenantContext } from "../tenancy/tenant-context";
import { MembershipsService } from "../memberships/memberships.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { UsersService } from "../users/users.service";
import { EmailQueueService } from "../notifications/email-queue.service";
import { QuotaService } from "../usage/quota.service";
import { SubscriptionsService } from "../billing/subscriptions.service";
import type { InviteMemberDto } from "./dto/invitation.dto";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name) private readonly invitationModel: Model<InvitationDocument>,
    private readonly membershipsService: MembershipsService,
    private readonly organizationsService: OrganizationsService,
    private readonly usersService: UsersService,
    private readonly emailQueueService: EmailQueueService,
    private readonly quotaService: QuotaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async invite(dto: InviteMemberDto, webAppUrl: string) {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("InvitationsService.invite called with no tenant context");

    const existingPending = await this.invitationModel
      .findOne({ email: dto.email.toLowerCase(), acceptedAt: { $exists: false }, revokedAt: { $exists: false } })
      .exec();
    if (existingPending) {
      throw new ConflictException(
        "A pending invitation already exists for this email — revoke or resend it instead",
      );
    }

    const { rawToken, tokenHash } = generateInviteToken();
    const invitation = await this.invitationModel.create({
      email: dto.email.toLowerCase(),
      role: dto.role,
      tokenHash,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedBy: new Types.ObjectId(ctx.userId),
    });

    await this.sendInviteEmail(invitation, rawToken, ctx.userId, webAppUrl);
    return invitation;
  }

  async listPending() {
    return this.invitationModel
      .find({ acceptedAt: { $exists: false }, revokedAt: { $exists: false } })
      .sort({ createdAt: -1 })
      .exec();
  }

  async resend(invitationId: string, webAppUrl: string) {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("InvitationsService.resend called with no tenant context");

    const invitation = await this.invitationModel.findById(invitationId).exec();
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.acceptedAt) throw new ConflictException("Invitation already accepted");
    if (invitation.revokedAt) throw new ConflictException("Invitation was revoked");

    const { rawToken, tokenHash } = generateInviteToken();
    invitation.tokenHash = tokenHash;
    invitation.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await invitation.save();

    await this.sendInviteEmail(invitation, rawToken, ctx.userId, webAppUrl);
    return invitation;
  }

  async revoke(invitationId: string) {
    const invitation = await this.invitationModel.findById(invitationId).exec();
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.acceptedAt) throw new ConflictException("Invitation already accepted");

    invitation.revokedAt = new Date();
    await invitation.save();
    return invitation;
  }

  /**
   * The only method in this service that runs with NO tenant context — the
   * caller hasn't been resolved to a membership in this org yet (that's the
   * whole point of accepting an invite). It reads the raw collection
   * directly, deliberately bypassing tenantScopePlugin's query hooks: the
   * token itself (256 bits of entropy, single-use, time-limited) is the
   * authorization here, not an org membership. This is NOT the admin
   * bypass (tenant-bypass.ts) — that's for platform admins reading across
   * tenants and is logged as such; this is an ordinary anonymous capability
   * gated by possession of the token, same trust model as a password-reset
   * link.
   */
  async findByRawToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const raw = await this.invitationModel.collection.findOne({ tokenHash });
    if (!raw) return null;
    return raw as unknown as InvitationDocument;
  }

  async accept(rawToken: string, acceptingUser: { id: string; email: string }) {
    const invitation = await this.findByRawToken(rawToken);
    if (!invitation) throw new NotFoundException("Invitation not found or already used");
    if (invitation.revokedAt) throw new ConflictException("Invitation was revoked");
    if (invitation.acceptedAt) throw new ConflictException("Invitation already accepted");
    if (invitation.expiresAt.getTime() < Date.now()) throw new ConflictException("Invitation has expired");
    if (invitation.email.toLowerCase() !== acceptingUser.email.toLowerCase()) {
      throw new ForbiddenException("This invitation was sent to a different email address");
    }

    const tenantId = invitation.tenantId;

    const existingMembership = await this.membershipsService.findOne(acceptingUser.id, tenantId);
    if (!existingMembership) {
      const plan = await this.subscriptionsService.findPlanByTenantId(tenantId);
      await this.quotaService.assertSeatQuotaNotExceededForOrg(tenantId, plan);
    }

    return TenantContext.run(
      { tenantId, userId: acceptingUser.id, role: invitation.role },
      async () => {
        if (!existingMembership) {
          await this.membershipsService.create({
            userId: new Types.ObjectId(acceptingUser.id),
            orgId: new Types.ObjectId(tenantId),
            role: invitation.role,
            invitedBy: invitation.invitedBy,
          });
        }

        await this.invitationModel.findOneAndUpdate(
          { _id: invitation._id },
          { acceptedAt: new Date() },
        );

        const org = await this.organizationsService.findById(tenantId);
        return { orgId: tenantId, orgName: org?.name, role: invitation.role };
      },
    );
  }

  private async sendInviteEmail(
    invitation: InvitationDocument,
    rawToken: string,
    inviterId: string,
    webAppUrl: string,
  ) {
    const [org, inviter] = await Promise.all([
      this.organizationsService.findById(invitation.tenantId),
      this.usersService.findById(inviterId),
    ]);

    await this.emailQueueService.enqueueInviteEmail({
      to: invitation.email,
      orgName: org?.name ?? "the organization",
      inviterName: inviter?.name ?? "Someone",
      acceptUrl: `${webAppUrl}/invitations/accept?token=${rawToken}`,
    });
  }
}
