import { WebhooksService } from "./webhooks.service";

function buildEvent(overrides: Partial<{ id: string; type: string; created: number; data: unknown }>) {
  return {
    id: "evt_1",
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
    ...overrides,
  } as never;
}

describe("WebhooksService", () => {
  function buildService() {
    const stripe = {
      webhooks: { constructEvent: jest.fn() },
      subscriptions: { retrieve: jest.fn() },
    };
    const webhookEventModel = { create: jest.fn() };
    const subscriptionsService = {
      findTenantIdByStripeSubscriptionId: jest.fn(),
      applyStripeChange: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          STRIPE_WEBHOOK_SECRET: "whsec_test",
          STRIPE_PRICE_PRO: "price_pro",
          STRIPE_PRICE_BUSINESS: "price_business",
        };
        return values[key];
      }),
    };

    const service = new WebhooksService(
      stripe as never,
      webhookEventModel as never,
      subscriptionsService as never,
      config as never,
    );

    return { service, stripe, webhookEventModel, subscriptionsService, config };
  }

  describe("verifyAndParse", () => {
    it("rejects when the webhook secret isn't configured", () => {
      const { service, config } = buildService();
      (config.get as jest.Mock).mockReturnValue(undefined);
      expect(() => service.verifyAndParse(Buffer.from("{}"), "sig")).toThrow(/not configured/);
    });

    it("rejects an invalid signature", () => {
      const { service, stripe } = buildService();
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("signature mismatch");
      });
      expect(() => service.verifyAndParse(Buffer.from("{}"), "bad-sig")).toThrow(/Invalid webhook signature/);
    });
  });

  describe("handleEvent — idempotency", () => {
    it("processes a new event and records it", async () => {
      const { service, webhookEventModel, subscriptionsService } = buildService();
      webhookEventModel.create.mockResolvedValue({});
      subscriptionsService.findTenantIdByStripeSubscriptionId.mockResolvedValue("tenant-1");
      subscriptionsService.applyStripeChange.mockResolvedValue({});

      const event = buildEvent({
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            status: "active",
            items: { data: [{ price: { id: "price_pro" } }] },
            current_period_end: 1_700_000_000,
            cancel_at_period_end: false,
            metadata: {},
          },
        },
      });

      await service.handleEvent(event, Buffer.from("payload"));

      expect(webhookEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ stripeEventId: "evt_1", type: "customer.subscription.updated" }),
      );
      expect(subscriptionsService.applyStripeChange).toHaveBeenCalled();
    });

    it("is a no-op for a duplicate event (unique-index violation on claim)", async () => {
      const { service, webhookEventModel, subscriptionsService } = buildService();
      webhookEventModel.create.mockRejectedValue({ code: 11000 });

      const event = buildEvent({});
      await service.handleEvent(event, Buffer.from("payload"));

      expect(subscriptionsService.applyStripeChange).not.toHaveBeenCalled();
    });

    it("propagates a non-duplicate-key error from the claim step", async () => {
      const { service, webhookEventModel } = buildService();
      webhookEventModel.create.mockRejectedValue(new Error("disk full"));

      await expect(service.handleEvent(buildEvent({}), Buffer.from("payload"))).rejects.toThrow("disk full");
    });
  });

  describe("subscription reconciliation", () => {
    it("resolves the org from subscription metadata and reconciles plan/status", async () => {
      const { service, webhookEventModel, subscriptionsService } = buildService();
      webhookEventModel.create.mockResolvedValue({});
      subscriptionsService.applyStripeChange.mockResolvedValue({});

      const event = buildEvent({
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            status: "past_due",
            items: { data: [{ price: { id: "price_business" } }] },
            current_period_end: 1_700_000_000,
            cancel_at_period_end: false,
            metadata: { orgId: "tenant-from-metadata" },
          },
        },
      });

      await service.handleEvent(event, Buffer.from("payload"));

      expect(subscriptionsService.findTenantIdByStripeSubscriptionId).not.toHaveBeenCalled();
      expect(subscriptionsService.applyStripeChange).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "business", status: "past_due" }),
        expect.any(Date),
      );
    });

    it("falls back to looking up the org by subscription id when metadata is missing", async () => {
      const { service, webhookEventModel, subscriptionsService } = buildService();
      webhookEventModel.create.mockResolvedValue({});
      subscriptionsService.findTenantIdByStripeSubscriptionId.mockResolvedValue("tenant-by-lookup");
      subscriptionsService.applyStripeChange.mockResolvedValue({});

      const event = buildEvent({
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_2",
            status: "canceled",
            items: { data: [] },
            current_period_end: 1_700_000_000,
            cancel_at_period_end: false,
            metadata: {},
          },
        },
      });

      await service.handleEvent(event, Buffer.from("payload"));

      expect(subscriptionsService.findTenantIdByStripeSubscriptionId).toHaveBeenCalledWith("sub_2");
      expect(subscriptionsService.applyStripeChange).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "free", status: "canceled" }),
        expect.any(Date),
      );
    });

    it("skips silently when no org can be resolved at all", async () => {
      const { service, webhookEventModel, subscriptionsService } = buildService();
      webhookEventModel.create.mockResolvedValue({});
      subscriptionsService.findTenantIdByStripeSubscriptionId.mockResolvedValue(null);

      const event = buildEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "sub_orphan", items: { data: [] }, metadata: {} } },
      });

      await expect(service.handleEvent(event, Buffer.from("payload"))).resolves.toBeUndefined();
      expect(subscriptionsService.applyStripeChange).not.toHaveBeenCalled();
    });
  });

  describe("invoice events", () => {
    it("invoice.paid reconciles status to active via subscription lookup", async () => {
      const { service, webhookEventModel, subscriptionsService } = buildService();
      webhookEventModel.create.mockResolvedValue({});
      subscriptionsService.findTenantIdByStripeSubscriptionId.mockResolvedValue("tenant-1");
      subscriptionsService.applyStripeChange.mockResolvedValue({});

      const event = buildEvent({
        type: "invoice.paid",
        data: { object: { subscription: "sub_1" } },
      });

      await service.handleEvent(event, Buffer.from("payload"));

      expect(subscriptionsService.applyStripeChange).toHaveBeenCalledWith(
        { status: "active" },
        expect.any(Date),
      );
    });

    it("invoice.payment_failed reconciles status to past_due", async () => {
      const { service, webhookEventModel, subscriptionsService } = buildService();
      webhookEventModel.create.mockResolvedValue({});
      subscriptionsService.findTenantIdByStripeSubscriptionId.mockResolvedValue("tenant-1");
      subscriptionsService.applyStripeChange.mockResolvedValue({});

      const event = buildEvent({
        type: "invoice.payment_failed",
        data: { object: { subscription: "sub_1" } },
      });

      await service.handleEvent(event, Buffer.from("payload"));

      expect(subscriptionsService.applyStripeChange).toHaveBeenCalledWith(
        { status: "past_due" },
        expect.any(Date),
      );
    });
  });

  it("charge.dispute.created is acknowledged without throwing", async () => {
    const { service, webhookEventModel } = buildService();
    webhookEventModel.create.mockResolvedValue({});

    const event = buildEvent({
      type: "charge.dispute.created",
      data: { object: { id: "dp_1" } },
    });

    await expect(service.handleEvent(event, Buffer.from("payload"))).resolves.toBeUndefined();
  });
});
