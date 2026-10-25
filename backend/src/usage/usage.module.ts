import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { UsageRecord, UsageRecordSchema } from "./schemas/usage-record.schema";
import { UsageRollup, UsageRollupSchema } from "./schemas/usage-rollup.schema";
import { Project, ProjectSchema } from "../projects/schemas/project.schema";
import { Membership, MembershipSchema } from "../memberships/schemas/membership.schema";
import { Subscription, SubscriptionSchema } from "../billing/schemas/subscription.schema";
import { UsageService } from "./usage.service";
import { QuotaService } from "./quota.service";
import { UsageController } from "./usage.controller";
import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { UsersModule } from "../users/users.module";
import { MembershipsModule } from "../memberships/memberships.module";
import { BillingModule } from "../billing/billing.module";

/**
 * Deliberately has NO BullMQ registration — QuotaService/UsageService are
 * pure Mongo logic that ProjectsModule/InvitationsModule need for quota
 * checks on every mutation, and forcing a Redis-backed queue registration
 * into every consumer of this module (including narrow test module graphs
 * that have no root BullModule.forRootAsync connection) would be a needless
 * coupling. The actual rollup job lives in UsageRollupModule instead.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UsageRecord.name, schema: UsageRecordSchema },
      { name: UsageRollup.name, schema: UsageRollupSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    AuthModule,
    TenancyModule,
    UsersModule,
    MembershipsModule,
    BillingModule,
  ],
  providers: [UsageService, QuotaService],
  controllers: [UsageController],
  exports: [UsageService, QuotaService],
})
export class UsageModule {}
