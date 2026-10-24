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

  async applyStripeChange(data: {
    stripeSubscriptionId?: string;
    stripePriceId?: string;
    plan: Plan;
    status: SubscriptionStatus;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
  }) {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("SubscriptionsService.applyStripeChange called with no tenant context");

    const updated = await this.subscriptionModel
      .findOneAndUpdate({}, { $set: data }, { new: true, upsert: true, setDefaultsOnInsert: true })
      .exec();
    return updated!;
  }
}
