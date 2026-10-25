import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { UsageService } from "./usage.service";
import { SubscriptionsService } from "../billing/subscriptions.service";
import { Project, ProjectDocument } from "../projects/schemas/project.schema";
import { Membership, MembershipDocument } from "../memberships/schemas/membership.schema";
import { quotaFor } from "./quotas";
import { QuotaExceededException } from "./quota-exceeded.exception";
import { TenantContext } from "../tenancy/tenant-context";
import type { Plan, UsageMetric } from "../common/enums";

@Injectable()
export class QuotaService {
  constructor(
    private readonly usageService: UsageService,
    private readonly subscriptionsService: SubscriptionsService,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Membership.name) private readonly membershipModel: Model<MembershipDocument>,
  ) {}

  /** Count-based quota: compares a live count against the plan limit, not a cumulative event log. */
  async assertProjectQuotaNotExceeded(): Promise<void> {
    const quota = await this.quotaFor("projects");
    if (quota === null) return;

    const current = await this.projectModel.countDocuments().exec();
    if (current >= quota) throw new QuotaExceededException("projects", quota);
  }

  /**
   * Seats are counted against the TARGET org (the one the new member is
   * joining), using a native-driver count — the accepting user has no
   * tenant context for that org yet (same reason Invitation acceptance
   * reads the raw collection in Module E), so this can't go through the
   * normal tenant-scoped Membership query.
   */
  async assertSeatQuotaNotExceededForOrg(tenantId: string, plan: Plan): Promise<void> {
    const quota = quotaFor(plan, "seats");
    if (quota === null) return;

    // Native-driver access skips Mongoose's automatic string->ObjectId
    // casting, so orgId has to be cast explicitly here.
    const current = await this.membershipModel.collection.countDocuments({
      orgId: new Types.ObjectId(tenantId),
      status: "active",
    });
    if (current >= quota) throw new QuotaExceededException("seats", quota);
  }

  /**
   * Meters one api_calls event AND enforces the quota in a single call —
   * the demonstration of the brief's "record usage with an idempotency
   * key... enforce at the mutation boundary" requirement, reusable by any
   * future endpoint that wants to meter itself the same way.
   */
  async meterApiCallAndEnforceQuota(idempotencyKey?: string): Promise<void> {
    const quota = await this.quotaFor("api_calls");
    if (quota !== null) {
      const used = await this.usageService.sumForCurrentPeriod("api_calls");
      if (used >= quota) throw new QuotaExceededException("api_calls", quota);
    }
    await this.usageService.record("api_calls", 1, idempotencyKey);
  }

  /** Live count, for the dashboard — projects/seats are never written to UsageRecord. */
  async getCurrentProjectCount(): Promise<number> {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("QuotaService called with no tenant context");
    return this.projectModel.countDocuments().exec();
  }

  async getCurrentSeatCount(): Promise<number> {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("QuotaService called with no tenant context");
    return this.membershipModel.countDocuments({ orgId: ctx.tenantId, status: "active" }).exec();
  }

  private async quotaFor(metric: UsageMetric) {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("QuotaService called with no tenant context");
    const subscription = await this.subscriptionsService.getForActiveOrgOrThrow();
    return quotaFor(subscription.plan, metric);
  }
}
