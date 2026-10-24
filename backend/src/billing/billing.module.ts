import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Subscription, SubscriptionSchema } from "./schemas/subscription.schema";
import { BillingService } from "./billing.service";
import { BillingController } from "./billing.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { StripeModule } from "./stripe.module";
import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { UsersModule } from "../users/users.module";
import { MembershipsModule } from "../memberships/memberships.module";
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Subscription.name, schema: SubscriptionSchema }]),
    StripeModule,
    AuthModule,
    TenancyModule,
    UsersModule,
    MembershipsModule,
    OrganizationsModule,
  ],
  providers: [BillingService, SubscriptionsService],
  controllers: [BillingController],
  exports: [BillingService, SubscriptionsService],
})
export class BillingModule {}
