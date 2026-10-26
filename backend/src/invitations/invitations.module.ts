import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Invitation, InvitationSchema } from "./schemas/invitation.schema";
import { InvitationsService } from "./invitations.service";
import { InvitationsController } from "./invitations.controller";
import { InvitationsPublicController } from "./invitations-public.controller";
import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { UsersModule } from "../users/users.module";
import { MembershipsModule } from "../memberships/memberships.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BillingModule } from "../billing/billing.module";
import { UsageModule } from "../usage/usage.module";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Invitation.name, schema: InvitationSchema }]),
    AuthModule,
    TenancyModule,
    UsersModule,
    MembershipsModule,
    OrganizationsModule,
    NotificationsModule,
    BillingModule,
    UsageModule,
    AuditLogModule,
  ],
  providers: [InvitationsService],
  controllers: [InvitationsController, InvitationsPublicController],
  exports: [InvitationsService],
})
export class InvitationsModule {}
