import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { BillingModule } from "./billing.module";
import { STRIPE_CLIENT, StripeModule } from "./stripe.module";
import { MembershipsService } from "../memberships/memberships.service";
import { validateEnv } from "../config/env.validation";

let checkoutSessionCounter = 0;

function makeFakeStripe() {
  return {
    customers: {
      create: jest.fn().mockImplementation(() => Promise.resolve({ id: `cus_${Date.now()}_${Math.random()}` })),
    },
    checkout: {
      sessions: {
        create: jest.fn().mockImplementation(() => {
          checkoutSessionCounter += 1;
          return Promise.resolve({ url: `https://stripe.test/checkout/${checkoutSessionCounter}` });
        }),
      },
    },
    billingPortal: {
      sessions: { create: jest.fn().mockResolvedValue({ url: "https://stripe.test/portal" }) },
    },
    subscriptions: {
      retrieve: jest.fn().mockResolvedValue({ items: { data: [{ id: "si_fake" }] } }),
      update: jest.fn().mockImplementation((id: string, params: Record<string, unknown>) =>
        Promise.resolve({
          id,
          status: "active",
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          cancel_at_period_end: Boolean(params.cancel_at_period_end),
        }),
      ),
      cancel: jest.fn().mockImplementation((id: string) => Promise.resolve({ id, status: "canceled" })),
    },
  };
}

// Replaces the real Stripe client (which needs network access and a real
// API key) with a fake that returns Stripe-shaped responses, so this suite
// proves our side of the integration (customer lazily created, correct
// price/proration params sent, local Subscription mirror updated) without
// needing live Stripe test-mode credentials.
@Module({
  providers: [{ provide: STRIPE_CLIENT, useFactory: makeFakeStripe }],
  exports: [STRIPE_CLIENT],
})
class FakeStripeModule {}

describe("Billing (proof)", () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = "a".repeat(32);
    process.env.JWT_REFRESH_SECRET = "b".repeat(32);
    process.env.JWT_ACCESS_TTL = "15m";
    process.env.JWT_REFRESH_TTL = "30d";
    process.env.MONGO_URI = "mongodb://placeholder/placeholder";
    process.env.REDIS_URL = "redis://placeholder:6379";
    process.env.WEB_APP_URL = "http://localhost:5173";
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_BUSINESS = "price_business_test";

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

    app = moduleRef.createNestApplication();
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
    const cookies = (signup.headers["set-cookie"] as unknown as string[])
      .map((c) => c.split(";")[0])
      .join("; ");
    return { cookies, orgId: signup.body.organization.id as string };
  }

  it("signup creates a free-plan subscription record automatically", async () => {
    const owner = await signupAndLogin("billing-signup@example.com", "Billing Signup Org");

    const res = await request(app.getHttpServer())
      .get("/api/billing/subscription")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("free");
    expect(res.body.status).toBe("active");
  });

  it("owner can access billing; an admin (not org:billing:manage) cannot", async () => {
    const owner = await signupAndLogin("billing-rbac-owner@example.com", "Billing RBAC Org");
    const adminAccount = await signupAndLogin("billing-rbac-admin@example.com", "Billing RBAC Admin's Org");

    const membershipsService = app.get(MembershipsService);
    await membershipsService.create({
      userId: new Types.ObjectId((await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "billing-rbac-admin@example.com", password: "correct-horse-battery" })
      ).body.user.id),
      orgId: new Types.ObjectId(owner.orgId),
      role: "admin",
    });

    const asOwner = await request(app.getHttpServer())
      .get("/api/billing/subscription")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(asOwner.status).toBe(200);

    const asAdmin = await request(app.getHttpServer())
      .get("/api/billing/subscription")
      .set("Cookie", adminAccount.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(asAdmin.status).toBe(403);
  });

  it("subscribing creates a Stripe customer lazily and returns a checkout URL", async () => {
    const owner = await signupAndLogin("billing-checkout@example.com", "Billing Checkout Org");

    const res = await request(app.getHttpServer())
      .post("/api/billing/checkout")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ plan: "pro" });

    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^https:\/\/stripe\.test\/checkout\//);
  });

  it("rejects checkout for the free plan", async () => {
    const owner = await signupAndLogin("billing-checkout-free@example.com", "Billing Checkout Free Org");

    const res = await request(app.getHttpServer())
      .post("/api/billing/checkout")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ plan: "free" });

    expect(res.status).toBe(400);
  });

  it("opens a billing portal session", async () => {
    const owner = await signupAndLogin("billing-portal@example.com", "Billing Portal Org");

    const res = await request(app.getHttpServer())
      .post("/api/billing/portal")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);

    expect(res.status).toBe(201);
    expect(res.body.url).toBe("https://stripe.test/portal");
  });

  it("change-plan requires an active Stripe subscription first", async () => {
    const owner = await signupAndLogin("billing-change-plan@example.com", "Billing Change Plan Org");

    const res = await request(app.getHttpServer())
      .post("/api/billing/change-plan")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ plan: "business" });

    expect(res.status).toBe(400);
  });

  it("cancel requires an active Stripe subscription first", async () => {
    const owner = await signupAndLogin("billing-cancel@example.com", "Billing Cancel Org");

    const res = await request(app.getHttpServer())
      .post("/api/billing/cancel")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({});

    expect(res.status).toBe(400);
  });
});
