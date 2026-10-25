import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { tenantScopePlugin } from "../../tenancy/tenant-scope.plugin";
import { PLANS, SUBSCRIPTION_STATUSES, type Plan, type SubscriptionStatus } from "../../common/enums";

/**
 * Mirrors Stripe. Stripe is the source of truth — this collection exists so
 * the app can answer "what plan is this org on" without calling Stripe on
 * every request, not as an independent record of billing state. Module G's
 * webhook handler is what actually keeps it correct; the write paths here
 * (checkout/change-plan/cancel) update it optimistically for immediate UI
 * feedback, but a webhook event always wins if it disagrees.
 */
@Schema({ timestamps: true, collection: "subscriptions" })
export class Subscription {
  _id!: Types.ObjectId;

  // Stamped automatically by tenantScopePlugin — never set this by hand.
  @Prop({ required: true, index: true, unique: true })
  tenantId!: string;

  @Prop({ sparse: true, unique: true })
  stripeSubscriptionId?: string;

  @Prop()
  stripePriceId?: string;

  @Prop({ required: true, enum: PLANS, default: "free" })
  plan!: Plan;

  @Prop({ required: true, enum: SUBSCRIPTION_STATUSES, default: "active" })
  status!: SubscriptionStatus;

  @Prop()
  currentPeriodEnd?: Date;

  @Prop({ default: false })
  cancelAtPeriodEnd!: boolean;

  /**
   * The `created` timestamp of the last Stripe webhook event that actually
   * updated this document — not when WE wrote it, when STRIPE says the
   * event happened. Lets applyStripeChange detect and discard an
   * out-of-order webhook (one whose event is older than what's already
   * been applied) instead of letting stale data clobber newer state.
   * Unset for action-initiated (non-webhook) writes, which always apply.
   */
  @Prop()
  lastReconciledEventAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SubscriptionDocument = Subscription & Document;
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
SubscriptionSchema.plugin(tenantScopePlugin);
