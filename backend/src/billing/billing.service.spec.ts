import { BadRequestException } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { TenantContext } from "../tenancy/tenant-context";

describe("BillingService", () => {
  const tenantId = "tenant-1";

  function buildService() {
    const stripe = {
      checkout: { sessions: { create: jest.fn() } },
      billingPortal: { sessions: { create: jest.fn() } },
      subscriptions: { retrieve: jest.fn(), update: jest.fn(), cancel: jest.fn() },
      customers: { create: jest.fn() },
    };
    const organizationsService = {
      findById: jest.fn(),
      setStripeCustomerId: jest.fn(),
    };
    const subscriptionsService = {
      getForActiveOrgOrThrow: jest.fn(),
      applyStripeChange: jest.fn(),
    };
    const auditLogService = { record: jest.fn() };
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          WEB_APP_URL: "http://localhost:5173",
          STRIPE_PRICE_PRO: "price_pro",
          STRIPE_PRICE_BUSINESS: "price_business",
        };
        return values[key];
      }),
    };

    const service = new BillingService(
      stripe as never,
      organizationsService as never,
      subscriptionsService as never,
      auditLogService as never,
      config as never,
    );

    return { service, stripe, organizationsService, subscriptionsService, auditLogService, config };
  }

  describe("createCheckoutSession", () => {
    it("creates a Stripe customer lazily if the org doesn't have one yet", async () => {
      const { service, stripe, organizationsService } = buildService();
      organizationsService.findById.mockResolvedValue({ name: "Acme", stripeCustomerId: undefined });
      organizationsService.setStripeCustomerId.mockResolvedValue(undefined);
      stripe.customers.create.mockResolvedValue({ id: "cus_new" });
      stripe.checkout.sessions.create.mockResolvedValue({ url: "https://stripe.test/checkout" });

      const result = await TenantContext.run({ tenantId, userId: "u1", role: "owner" }, () =>
        service.createCheckoutSession("pro"),
      );

      expect(stripe.customers.create).toHaveBeenCalled();
      expect(organizationsService.setStripeCustomerId).toHaveBeenCalledWith(tenantId, "cus_new");
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "cus_new",
          mode: "subscription",
          line_items: [{ price: "price_pro", quantity: 1 }],
        }),
      );
      expect(result).toEqual({ url: "https://stripe.test/checkout" });
    });

    it("reuses an existing Stripe customer without creating a new one", async () => {
      const { service, stripe, organizationsService } = buildService();
      organizationsService.findById.mockResolvedValue({ name: "Acme", stripeCustomerId: "cus_existing" });
      stripe.checkout.sessions.create.mockResolvedValue({ url: "https://stripe.test/checkout" });

      await TenantContext.run({ tenantId, userId: "u1", role: "owner" }, () =>
        service.createCheckoutSession("business"),
      );

      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_existing" }),
      );
    });

    it("rejects checkout for the free plan — it isn't a Stripe subscription", async () => {
      const { service } = buildService();
      await expect(
        TenantContext.run({ tenantId, userId: "u1", role: "owner" }, () => service.createCheckoutSession("free" as never)),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("createPortalSession", () => {
    it("creates a billing portal session for the org's Stripe customer", async () => {
      const { service, stripe, organizationsService } = buildService();
      organizationsService.findById.mockResolvedValue({ name: "Acme", stripeCustomerId: "cus_1" });
      stripe.billingPortal.sessions.create.mockResolvedValue({ url: "https://stripe.test/portal" });

      const result = await TenantContext.run({ tenantId, userId: "u1", role: "owner" }, () =>
        service.createPortalSession(),
      );

      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: "cus_1",
        return_url: "http://localhost:5173/billing",
      });
      expect(result).toEqual({ url: "https://stripe.test/portal" });
    });
  });

  describe("changePlan", () => {
    it("always creates prorations when switching the price on the existing subscription item", async () => {
      const { service, stripe, subscriptionsService } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_pro",
        plan: "pro",
      });
      stripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1" }] } });
      stripe.subscriptions.update.mockResolvedValue({
        id: "sub_1",
        status: "active",
        current_period_end: 1_700_000_000,
        cancel_at_period_end: false,
      });
      subscriptionsService.applyStripeChange.mockResolvedValue({});

      await service.changePlan("business");

      expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
        items: [{ id: "si_1", price: "price_business" }],
        proration_behavior: "create_prorations",
      });
      expect(subscriptionsService.applyStripeChange).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "business", stripePriceId: "price_business" }),
      );
    });

    it("rejects changing plan when there is no active Stripe subscription", async () => {
      const { service, subscriptionsService } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({ stripeSubscriptionId: undefined });

      await expect(service.changePlan("business")).rejects.toThrow(BadRequestException);
    });
  });

  describe("cancel", () => {
    it("cancel at period end keeps the subscription active until then", async () => {
      const { service, stripe, subscriptionsService } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_pro",
        plan: "pro",
      });
      stripe.subscriptions.update.mockResolvedValue({
        id: "sub_1",
        status: "active",
        current_period_end: 1_700_000_000,
        cancel_at_period_end: true,
      });
      subscriptionsService.applyStripeChange.mockResolvedValue({});

      await service.cancel(true);

      expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
      expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect(subscriptionsService.applyStripeChange).toHaveBeenCalledWith(
        expect.objectContaining({ cancelAtPeriodEnd: true, status: "active" }),
      );
    });

    it("immediate cancel ends the subscription now and downgrades to free locally", async () => {
      const { service, stripe, subscriptionsService } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_pro",
        plan: "pro",
      });
      stripe.subscriptions.cancel.mockResolvedValue({ id: "sub_1", status: "canceled" });
      subscriptionsService.applyStripeChange.mockResolvedValue({});

      await service.cancel(false);

      expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      expect(subscriptionsService.applyStripeChange).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "free", status: "canceled", cancelAtPeriodEnd: false }),
      );
    });
  });
});
