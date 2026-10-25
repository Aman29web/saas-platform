import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Subscription, SubscriptionSchema } from "./schemas/subscription.schema";
import { WebhookEvent, WebhookEventSchema } from "./schemas/webhook-event.schema";
import { BillingService } from "./billing.service";
import { BillingController } from "./billing.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { WebhooksService } from "./webhooks.service";
import { WebhooksController } from "./webhooks.controller";
import { StripeModule } from "./stripe.module";
import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { UsersModule } from "../users/users.module";
import { MembershipsModule } from "../memberships/memberships.module";
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: WebhookEvent.name, schema: WebhookEventSchema },
    ]),
    StripeModule,
    AuthModule,
    TenancyModule,
    UsersModule,
    MembershipsModule,
    OrganizationsModule,
  ],
  providers: [BillingService, SubscriptionsService, WebhooksService],
  controllers: [BillingController, WebhooksController],
  exports: [BillingService, SubscriptionsService],
})
export class BillingModule {}
