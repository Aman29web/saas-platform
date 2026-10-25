import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { createHash } from "crypto";
import type Stripe from "stripe";
import { STRIPE_CLIENT } from "./stripe.module";
import { WebhookEvent, WebhookEventDocument } from "./schemas/webhook-event.schema";
import { SubscriptionsService } from "./subscriptions.service";
import { TenantContext } from "../tenancy/tenant-context";
import { planForPriceId } from "./plan-prices";
import type { Plan, SubscriptionStatus } from "../common/enums";
import type { ApiEnv } from "../config/env.schema";

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @InjectModel(WebhookEvent.name) private readonly webhookEventModel: Model<WebhookEventDocument>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  verifyAndParse(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
    if (!secret) throw new BadRequestException("STRIPE_WEBHOOK_SECRET is not configured");

    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException("Invalid webhook signature");
    }
  }

  /**
   * Records the event BEFORE processing it, relying on the unique index on
   * stripeEventId rather than a check-then-act read: two concurrent
   * deliveries of the same event both racing to insert is exactly the
   * scenario a separate "does it exist?" read followed by an insert would
   * get wrong. Whichever insert wins processes the event; the other gets a
   * duplicate-key error and is told to skip — not an error from the
   * caller's point of view, the defining case idempotency exists for.
   */
  private async claimEvent(event: Stripe.Event, rawBody: Buffer): Promise<boolean> {
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    try {
      await this.webhookEventModel.create({
        stripeEventId: event.id,
        type: event.type,
        processedAt: new Date(),
        payloadHash,
      });
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  async handleEvent(event: Stripe.Event, rawBody: Buffer): Promise<void> {
    const claimed = await this.claimEvent(event, rawBody);
    if (!claimed) {
      this.logger.log(`Duplicate webhook delivery for ${event.id} (${event.type}) — no-op`);
      return;
    }

    switch (event.type) {
      case "checkout.session.completed":
        await this.onCheckoutSessionCompleted(event, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await this.onSubscriptionChanged(event, event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid":
        await this.onInvoiceOutcome(event, event.data.object as Stripe.Invoice, "active");
        break;
      case "invoice.payment_failed":
        await this.onInvoiceOutcome(event, event.data.object as Stripe.Invoice, "past_due");
        break;
      case "charge.dispute.created":
        this.logger.warn(`Dispute opened: ${(event.data.object as Stripe.Dispute).id}`);
        break;
      default:
        this.logger.debug(`Unhandled webhook event type: ${event.type}`);
    }
  }

  private async onCheckoutSessionCompleted(event: Stripe.Event, session: Stripe.Checkout.Session) {
    const orgId = session.metadata?.orgId;
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!orgId || !subscriptionId) {
      this.logger.warn(`checkout.session.completed ${event.id} missing orgId or subscription — skipping`);
      return;
    }

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    await this.reconcileSubscription(orgId, event, subscription);
  }

  private async onSubscriptionChanged(event: Stripe.Event, subscription: Stripe.Subscription) {
    const orgId =
      subscription.metadata?.orgId ??
      (await this.subscriptionsService.findTenantIdByStripeSubscriptionId(subscription.id));
    if (!orgId) {
      this.logger.warn(`${event.type} ${event.id} has no resolvable org — skipping`);
      return;
    }

    await this.reconcileSubscription(orgId, event, subscription);
  }

  private async onInvoiceOutcome(event: Stripe.Event, invoice: Stripe.Invoice, status: SubscriptionStatus) {
    const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
    if (!subscriptionId) {
      this.logger.warn(`${event.type} ${event.id} has no subscription — skipping`);
      return;
    }

    const orgId = await this.subscriptionsService.findTenantIdByStripeSubscriptionId(subscriptionId);
    if (!orgId) {
      this.logger.warn(`${event.type} ${event.id} has no resolvable org for subscription ${subscriptionId} — skipping`);
      return;
    }

    await TenantContext.run({ tenantId: orgId, userId: "stripe-webhook", role: "owner" }, () =>
      this.subscriptionsService.applyStripeChange({ status }, new Date(event.created * 1000)),
    );
  }

  private async reconcileSubscription(orgId: string, event: Stripe.Event, subscription: Stripe.Subscription) {
    const priceId = subscription.items.data[0]?.price.id;
    let plan: Plan | undefined;
    try {
      plan = priceId ? planForPriceId(priceId, this.config) : "free";
    } catch {
      this.logger.warn(`Unrecognized price ${priceId} on subscription ${subscription.id} — leaving plan unset`);
      plan = undefined;
    }

    await TenantContext.run({ tenantId: orgId, userId: "stripe-webhook", role: "owner" }, () =>
      this.subscriptionsService.applyStripeChange(
        {
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          plan,
          status: mapStripeStatus(subscription.status),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        new Date(event.created * 1000),
      ),
    );
  }
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "canceled";
    default:
      return "incomplete";
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 11000;
}
