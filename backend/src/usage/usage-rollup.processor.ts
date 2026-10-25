import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Subscription, SubscriptionDocument } from "../billing/schemas/subscription.schema";
import { UsageService } from "./usage.service";
import { TenantContext } from "../tenancy/tenant-context";

export const USAGE_ROLLUP_QUEUE_NAME = "usage-rollup";
export const USAGE_ROLLUP_JOB = "rollup-all-tenants";

@Processor(USAGE_ROLLUP_QUEUE_NAME)
export class UsageRollupProcessor extends WorkerHost {
  private readonly logger = new Logger(UsageRollupProcessor.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
    private readonly usageService: UsageService,
  ) {
    super();
  }

  async process(): Promise<void> {
    // Native-driver read, same reasoning as every other "no tenant context
    // exists yet" case in this codebase: a background job iterating every
    // tenant has no single tenant to scope itself to BEFORE it picks one.
    const tenantIds: string[] = await this.subscriptionModel.collection
      .distinct("tenantId")
      .then((ids) => ids as string[]);

    for (const tenantId of tenantIds) {
      try {
        await TenantContext.run({ tenantId, userId: "usage-rollup-job", role: "owner" }, () =>
          this.usageService.rollupCurrentPeriod(),
        );
      } catch (err) {
        this.logger.error(`Rollup failed for tenant ${tenantId}`, err instanceof Error ? err.stack : err);
      }
    }
  }
}
