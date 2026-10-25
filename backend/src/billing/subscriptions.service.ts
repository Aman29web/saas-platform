import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Subscription, SubscriptionDocument } from "./schemas/subscription.schema";
import { TenantContext } from "../tenancy/tenant-context";
import type { Plan, SubscriptionStatus } from "../common/enums";

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  async getForActiveOrgOrThrow() {
    const sub = await this.subscriptionModel.findOne().exec();
    if (!sub) throw new NotFoundException("No subscription record for this organization");
    return sub;
  }

  /**
   * The one choke point every write to Subscription goes through — Module
   * F's actions call it without `eventCreatedAt` (always applies, for
   * immediate UI feedback); Module G's webhook handler always passes it,
   * and a webhook whose event is OLDER than the last one actually applied
   * is discarded rather than allowed to clobber newer state. Delivery order
   * isn't guaranteed by Stripe, so this is the mechanism that makes
   * out-of-order webhooks converge instead of flapping.
   */
  async applyStripeChange(
    data: {
      stripeSubscriptionId?: string;
      stripePriceId?: string;
      plan?: Plan;
      status?: SubscriptionStatus;
      currentPeriodEnd?: Date;
      cancelAtPeriodEnd?: boolean;
    },
    eventCreatedAt?: Date,
  ) {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("SubscriptionsService.applyStripeChange called with no tenant context");

    const filter = eventCreatedAt
      ? { $or: [{ lastReconciledEventAt: { $exists: false } }, { lastReconciledEventAt: { $lt: eventCreatedAt } }] }
      : {};

    const setFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) setFields[key] = value;
    }
    if (eventCreatedAt) setFields.lastReconciledEventAt = eventCreatedAt;

    const updated = await this.subscriptionModel
      .findOneAndUpdate(filter, { $set: setFields }, { new: true, upsert: !eventCreatedAt, setDefaultsOnInsert: true })
      .exec();

    // A stale (out-of-order) webhook event matched no document — the
    // existing record's lastReconciledEventAt is already newer. Not an
    // error: this is the convergence mechanism working as intended.
    if (!updated) return this.subscriptionModel.findOne().exec();
    return updated;
  }

  /**
   * Used only by the webhook handler, which receives a Stripe subscription
   * or invoice id and needs to find which org it belongs to BEFORE any
   * tenant context exists — the same "token is the authorization, not a
   * membership" shape as Invitation acceptance (Module E) and the same
   * deliberate native-driver bypass of tenantScopePlugin's query hooks.
   */
  async findTenantIdByStripeSubscriptionId(stripeSubscriptionId: string): Promise<string | null> {
    const raw = await this.subscriptionModel.collection.findOne({ stripeSubscriptionId });
    return raw ? (raw.tenantId as string) : null;
  }

  /**
   * Same native-driver bypass, used by QuotaService to check a seat quota
   * for an org the caller doesn't have tenant context for yet (they're
   * accepting an invitation, not yet a member).
   */
  async findPlanByTenantId(tenantId: string): Promise<Plan> {
    const raw = await this.subscriptionModel.collection.findOne({ tenantId });
    return (raw?.plan as Plan) ?? "free";
  }
}
