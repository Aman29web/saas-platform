import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { BullModule } from "@nestjs/bullmq";
import { Subscription, SubscriptionSchema } from "../billing/schemas/subscription.schema";
import { UsageModule } from "./usage.module";
import { UsageRollupProcessor, USAGE_ROLLUP_QUEUE_NAME } from "./usage-rollup.processor";
import { UsageRollupScheduler } from "./usage-rollup.scheduler";

/**
 * Separate from UsageModule specifically so that QuotaService/UsageService
 * can be consumed (by ProjectsModule, InvitationsModule) without pulling in
 * a BullMQ queue registration that needs a real Redis connection — see the
 * comment on UsageModule. Only AppModule imports this one.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Subscription.name, schema: SubscriptionSchema }]),
    BullModule.registerQueue({ name: USAGE_ROLLUP_QUEUE_NAME }),
    UsageModule,
  ],
  providers: [UsageRollupProcessor, UsageRollupScheduler],
})
export class UsageRollupModule {}
