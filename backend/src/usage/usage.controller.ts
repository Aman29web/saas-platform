import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import { TenantContextGuard } from "../tenancy/tenant-context.guard";
import { TenantContextInterceptor } from "../tenancy/tenant-context.interceptor";
import { UsageService } from "./usage.service";
import { QuotaService } from "./quota.service";
import { SubscriptionsService } from "../billing/subscriptions.service";
import { quotaFor } from "./quotas";
import type { UsageMetric } from "../common/enums";

@Controller("usage")
@UseGuards(TenantContextGuard)
@UseInterceptors(TenantContextInterceptor)
export class UsageController {
  constructor(
    private readonly usageService: UsageService,
    private readonly quotaService: QuotaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Get()
  async dashboard() {
    const subscription = await this.subscriptionsService.getForActiveOrgOrThrow();

    const usedFor = async (metric: UsageMetric): Promise<number> => {
      if (metric === "projects") return this.quotaService.getCurrentProjectCount();
      if (metric === "seats") return this.quotaService.getCurrentSeatCount();
      return this.usageService.sumForCurrentPeriod(metric);
    };

    const metricNames: UsageMetric[] = ["projects", "seats", "api_calls", "storage_mb"];
    const metrics = await Promise.all(
      metricNames.map(async (metric) => {
        const used = await usedFor(metric);
        const quota = quotaFor(subscription.plan, metric);
        return { metric, used, quota, remaining: quota === null ? null : Math.max(quota - used, 0) };
      }),
    );

    return { plan: subscription.plan, metrics };
  }
}
