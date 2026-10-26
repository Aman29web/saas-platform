import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Stripe from "stripe";
import { STRIPE_CLIENT } from "./stripe.module";
import { SubscriptionsService } from "./subscriptions.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { TenantContext } from "../tenancy/tenant-context";
import { priceIdForPlan, planForPriceId } from "./plan-prices";
import { AuditLogService } from "../audit-log/audit-log.service";
import type { Plan } from "../common/enums";
import type { ApiEnv } from "../config/env.schema";

@Injectable()
export class BillingService {
  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly organizationsService: OrganizationsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly auditLogService: AuditLogService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  private webAppUrl(): string {
    return this.config.get("WEB_APP_URL", { infer: true });
  }

  async createCheckoutSession(plan: Plan) {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("createCheckoutSession called with no tenant context");

    const priceId = priceIdForPlan(plan, this.config);
    const customerId = await this.ensureStripeCustomer(ctx.tenantId);

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.webAppUrl()}/billing?checkout=success`,
      cancel_url: `${this.webAppUrl()}/billing?checkout=cancelled`,
      metadata: { orgId: ctx.tenantId, plan },
      subscription_data: { metadata: { orgId: ctx.tenantId } },
    });

    return { url: session.url };
  }

  async createPortalSession() {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("createPortalSession called with no tenant context");

    const customerId = await this.ensureStripeCustomer(ctx.tenantId);
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.webAppUrl()}/billing`,
    });

    return { url: session.url };
  }

  /**
   * Proration (not optional, not something the caller chooses): changing
   * plans mid-cycle always creates prorations, matching what a customer
   * sees in the Stripe portal. Immediate vs. deferred plan changes are a
   * product decision this module doesn't need to make — Stripe prorates
   * the difference onto the next invoice either way.
   */
  async changePlan(newPlan: Plan) {
    const subscription = await this.subscriptionsService.getForActiveOrgOrThrow();
    if (!subscription.stripeSubscriptionId) {
      throw new BadRequestException("No active Stripe subscription — use checkout to start one");
    }

    const newPriceId = priceIdForPlan(newPlan, this.config);
    const current = await this.stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const currentItem = current.items.data[0];
    if (!currentItem) throw new BadRequestException("Stripe subscription has no line items");

    const updated = await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: [{ id: currentItem.id, price: newPriceId }],
      proration_behavior: "create_prorations",
    });

    const result = await this.subscriptionsService.applyStripeChange({
      stripeSubscriptionId: updated.id,
      stripePriceId: newPriceId,
      plan: newPlan,
      status: updated.status as never,
      currentPeriodEnd: new Date(updated.current_period_end * 1000),
      cancelAtPeriodEnd: updated.cancel_at_period_end,
    });
    await this.auditLogService.record("subscription.plan_changed", "subscription", updated.id, {
      newPlan,
      previousPlan: subscription.plan,
    });
    return result;
  }

  async cancel(atPeriodEnd: boolean) {
    const subscription = await this.subscriptionsService.getForActiveOrgOrThrow();
    if (!subscription.stripeSubscriptionId) {
      throw new BadRequestException("No active Stripe subscription to cancel");
    }

    if (atPeriodEnd) {
      const updated = await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      const result = await this.subscriptionsService.applyStripeChange({
        stripeSubscriptionId: updated.id,
        stripePriceId: subscription.stripePriceId,
        plan: subscription.plan,
        status: updated.status as never,
        currentPeriodEnd: new Date(updated.current_period_end * 1000),
        cancelAtPeriodEnd: true,
      });
      await this.auditLogService.record("subscription.cancel_scheduled", "subscription", updated.id, {
        atPeriodEnd: true,
      });
      return result;
    }

    const cancelled = await this.stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
    const result = await this.subscriptionsService.applyStripeChange({
      stripeSubscriptionId: cancelled.id,
      stripePriceId: subscription.stripePriceId,
      plan: "free",
      status: "canceled",
      cancelAtPeriodEnd: false,
    });
    await this.auditLogService.record("subscription.cancelled", "subscription", cancelled.id, {
      atPeriodEnd: false,
    });
    return result;
  }

  private async ensureStripeCustomer(orgId: string): Promise<string> {
    const org = await this.organizationsService.findById(orgId);
    if (!org) throw new Error(`Organization ${orgId} not found while ensuring Stripe customer`);
    if (org.stripeCustomerId) return org.stripeCustomerId;

    const customer = await this.stripe.customers.create({
      name: org.name,
      metadata: { orgId },
    });
    await this.organizationsService.setStripeCustomerId(orgId, customer.id);
    return customer.id;
  }

  /** Exposed for webhook reconciliation in Module G. */
  resolvePlanForPrice(priceId: string): Plan {
    return planForPriceId(priceId, this.config);
  }
}
