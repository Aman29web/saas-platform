import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { MongooseModule, getModelToken } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import StripeSdk from "stripe";
import { BillingModule } from "./billing.module";
import { STRIPE_CLIENT, StripeModule } from "./stripe.module";
import { Subscription } from "./schemas/subscription.schema";
import { validateEnv } from "../config/env.validation";

const WEBHOOK_SECRET = "whsec_test_secret_for_signing_only";

// Only stripe.webhooks.constructEvent (pure HMAC verification, no network
// call) is real — every other Stripe API surface is faked, same as the
// billing integration suite.
function makeFakeStripe() {
  const real = new StripeSdk("sk_test_unused", { apiVersion: "2025-02-24.acacia" });
  return {
    webhooks: real.webhooks,
    subscriptions: {
      retrieve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: "active",
          items: { data: [{ price: { id: "price_pro_test" } }] },
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          cancel_at_period_end: false,
          metadata: {},
        }),
      ),
    },
    customers: { create: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
  };
}

@Module({
  providers: [{ provide: STRIPE_CLIENT, useFactory: makeFakeStripe }],
  exports: [STRIPE_CLIENT],
})
class FakeStripeModule {}

function signedRequest(payload: object) {
  const body = JSON.stringify(payload);
  const header = StripeSdk.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });
  return { body, header };
}

function subscriptionUpdatedEvent(overrides: {
  id: string;
  created: number;
  orgId: string;
  stripeSubscriptionId: string;
  priceId: string;
  status?: string;
  cancelAtPeriodEnd?: boolean;
}) {
  return {
    id: overrides.id,
    object: "event",
    type: "customer.subscription.updated",
    created: overrides.created,
    data: {
      object: {
        id: overrides.stripeSubscriptionId,
        status: overrides.status ?? "active",
        items: { data: [{ price: { id: overrides.priceId } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
        metadata: { orgId: overrides.orgId },
      },
    },
  };
}

describe("Webhooks (proof)", () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = "a".repeat(32);
    process.env.JWT_REFRESH_SECRET = "b".repeat(32);
    process.env.MONGO_URI = "mongodb://placeholder/placeholder";
    process.env.REDIS_URL = "redis://placeholder:6379";
    process.env.WEB_APP_URL = "http://localhost:5173";
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_BUSINESS = "price_business_test";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        MongooseModule.forRoot(replSet.getUri()),
        BillingModule,
      ],
    })
      .overrideModule(StripeModule)
      .useModule(FakeStripeModule)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.setGlobalPrefix("api");
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await replSet.stop();
  });

  async function signupAndLogin(email: string, orgName: string) {
    const signup = await request(app.getHttpServer()).post("/api/auth/signup").send({
      name: "User",
      email,
      password: "correct-horse-battery",
      orgName,
    });
    return { orgId: signup.body.organization.id as string };
  }

  function postWebhook(payload: object) {
    const { body, header } = signedRequest(payload);
    return request(app.getHttpServer())
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", header)
      .send(body);
  }

  it("rejects a webhook with an invalid signature", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=not-a-real-signature")
      .send(JSON.stringify({ id: "evt_fake", type: "customer.subscription.updated" }));

    expect(res.status).toBe(400);
  });

  it("a correctly signed subscription.updated event reconciles the local Subscription record", async () => {
    const { orgId } = await signupAndLogin("webhook-a@example.com", "Webhook Org A");
    const now = Math.floor(Date.now() / 1000);

    const res = await postWebhook(
      subscriptionUpdatedEvent({
        id: "evt_a_1",
        created: now,
        orgId,
        stripeSubscriptionId: "sub_a",
        priceId: "price_pro_test",
      }),
    );
    expect(res.status).toBe(200);

    const subscriptionModel = app.get(getModelToken(Subscription.name));
    const stored = await subscriptionModel.collection.findOne({ tenantId: orgId });
    expect(stored?.plan).toBe("pro");
    expect(stored?.status).toBe("active");
    expect(stored?.stripeSubscriptionId).toBe("sub_a");
  });

  it("a duplicate delivery of the same event id is a no-op, not a second write", async () => {
    const { orgId } = await signupAndLogin("webhook-b@example.com", "Webhook Org B");
    const now = Math.floor(Date.now() / 1000);
    const event = subscriptionUpdatedEvent({
      id: "evt_b_dup",
      created: now,
      orgId,
      stripeSubscriptionId: "sub_b",
      priceId: "price_pro_test",
    });

    const first = await postWebhook(event);
    expect(first.status).toBe(200);

    // Same event id, re-delivered (Stripe retries on timeout/5xx).
    const second = await postWebhook(event);
    expect(second.status).toBe(200);

    const webhookEventModel = app.get(getModelToken("WebhookEvent"));
    const count = await webhookEventModel.collection.countDocuments({ stripeEventId: "evt_b_dup" });
    expect(count).toBe(1);
  });

  it("out-of-order delivery converges: an older event arriving after a newer one is discarded", async () => {
    const { orgId } = await signupAndLogin("webhook-c@example.com", "Webhook Org C");
    const earlier = Math.floor(Date.now() / 1000) - 100;
    const later = Math.floor(Date.now() / 1000);

    // The NEWER event (cancel_at_period_end: true) arrives FIRST.
    const newerEvent = subscriptionUpdatedEvent({
      id: "evt_c_newer",
      created: later,
      orgId,
      stripeSubscriptionId: "sub_c",
      priceId: "price_business_test",
      cancelAtPeriodEnd: true,
    });
    const newerRes = await postWebhook(newerEvent);
    expect(newerRes.status).toBe(200);

    // The OLDER event (cancel_at_period_end: false, different price)
    // arrives SECOND — e.g. a retried delivery that got delayed.
    const olderEvent = subscriptionUpdatedEvent({
      id: "evt_c_older",
      created: earlier,
      orgId,
      stripeSubscriptionId: "sub_c",
      priceId: "price_pro_test",
      cancelAtPeriodEnd: false,
    });
    const olderRes = await postWebhook(olderEvent);
    expect(olderRes.status).toBe(200);

    const subscriptionModel = app.get(getModelToken(Subscription.name));
    const stored = await subscriptionModel.collection.findOne({ tenantId: orgId });
    // The older event must NOT have overwritten the newer state.
    expect(stored?.plan).toBe("business");
    expect(stored?.cancelAtPeriodEnd).toBe(true);
  });

  it("invoice.payment_failed transitions the subscription to past_due", async () => {
    const { orgId } = await signupAndLogin("webhook-d@example.com", "Webhook Org D");
    const now = Math.floor(Date.now() / 1000);

    await postWebhook(
      subscriptionUpdatedEvent({
        id: "evt_d_1",
        created: now - 10,
        orgId,
        stripeSubscriptionId: "sub_d",
        priceId: "price_pro_test",
      }),
    );

    const failedEvent = {
      id: "evt_d_failed",
      object: "event",
      type: "invoice.payment_failed",
      created: now,
      data: { object: { subscription: "sub_d" } },
    };
    const res = await postWebhook(failedEvent);
    expect(res.status).toBe(200);

    const subscriptionModel = app.get(getModelToken(Subscription.name));
    const stored = await subscriptionModel.collection.findOne({ tenantId: orgId });
    expect(stored?.status).toBe("past_due");

    // Recovery: invoice.paid brings it back to active.
    const paidEvent = {
      id: "evt_d_paid",
      object: "event",
      type: "invoice.paid",
      created: now + 1,
      data: { object: { subscription: "sub_d" } },
    };
    const recoveredRes = await postWebhook(paidEvent);
    expect(recoveredRes.status).toBe(200);

    const recovered = await subscriptionModel.collection.findOne({ tenantId: orgId });
    expect(recovered?.status).toBe("active");
  });

  it("an event with no resolvable org is acknowledged (200) without throwing", async () => {
    const res = await postWebhook({
      id: "evt_orphan",
      object: "event",
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "sub_orphan_unknown",
          status: "active",
          items: { data: [] },
          current_period_end: Math.floor(Date.now() / 1000),
          cancel_at_period_end: false,
          metadata: {},
        },
      },
    });
    expect(res.status).toBe(200);
  });
});
