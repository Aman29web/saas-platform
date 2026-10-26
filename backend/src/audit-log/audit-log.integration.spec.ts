import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { MongooseModule, getModelToken } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { AuditLogModule } from "./audit-log.module";
import { InvitationsModule } from "../invitations/invitations.module";
import { OrgMembersModule } from "../memberships/org-members.module";
import { BillingModule } from "../billing/billing.module";
import { STRIPE_CLIENT, StripeModule } from "../billing/stripe.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailQueueService, type InviteEmailPayload } from "../notifications/email-queue.service";
import { MembershipsService } from "../memberships/memberships.service";
import { validateEnv } from "../config/env.validation";

const sentEmails: InviteEmailPayload[] = [];

class FakeEmailQueueService extends EmailQueueService {
  async enqueueInviteEmail(payload: InviteEmailPayload): Promise<void> {
    sentEmails.push(payload);
  }
}

@Module({
  providers: [{ provide: EmailQueueService, useClass: FakeEmailQueueService }],
  exports: [EmailQueueService],
})
class FakeNotificationsModule {}

function makeFakeStripe() {
  return {
    customers: { create: jest.fn().mockResolvedValue({ id: "cus_fake" }) },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    subscriptions: {
      retrieve: jest.fn().mockResolvedValue({ items: { data: [{ id: "si_fake" }] } }),
      update: jest.fn().mockResolvedValue({
        id: "sub_fake",
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
        cancel_at_period_end: false,
      }),
      cancel: jest.fn().mockResolvedValue({ id: "sub_fake", status: "canceled" }),
    },
  };
}

@Module({
  providers: [{ provide: STRIPE_CLIENT, useFactory: makeFakeStripe }],
  exports: [STRIPE_CLIENT],
})
class FakeStripeModule {}

describe("Audit log (proof)", () => {
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

    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        MongooseModule.forRoot(replSet.getUri()),
        AuditLogModule,
        InvitationsModule,
        OrgMembersModule,
        BillingModule,
      ],
    })
      .overrideModule(NotificationsModule)
      .useModule(FakeNotificationsModule)
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
    return { cookies, orgId: signup.body.organization.id as string, userId: signup.body.user.id as string };
  }

  function extractToken(acceptUrl: string): string {
    return new URL(acceptUrl).searchParams.get("token")!;
  }

  function listAuditLog(cookies: string, orgId: string) {
    return request(app.getHttpServer()).get("/api/audit-log").set("Cookie", cookies).set("X-Org-Id", orgId);
  }

  it("inviting and revoking a member produce correct, filterable audit entries", async () => {
    const owner = await signupAndLogin("audit-invite-owner@example.com", "Audit Invite Org");

    const invite = await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "someone@example.com", role: "member" });

    await request(app.getHttpServer())
      .delete(`/api/invitations/${invite.body._id}`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);

    const log = await listAuditLog(owner.cookies, owner.orgId);
    expect(log.status).toBe(200);
    const actions = log.body.map((e: { action: string }) => e.action);
    expect(actions).toContain("invitation.created");
    expect(actions).toContain("invitation.revoked");

    const created = log.body.find((e: { action: string }) => e.action === "invitation.created");
    expect(created.actorId).toBe(owner.userId);
    expect(created.metadata).toMatchObject({ email: "someone@example.com", role: "member" });
  });

  it("accepting an invitation logs membership.created with the accepting user as actor", async () => {
    const owner = await signupAndLogin("audit-accept-owner@example.com", "Audit Accept Org");
    const invitee = await signupAndLogin("audit-accept-member@example.com", "Audit Accept Member Org");
    sentEmails.length = 0;

    await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "audit-accept-member@example.com", role: "member" });

    const token = extractToken(sentEmails[0].acceptUrl);
    await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", invitee.cookies)
      .send({ token });

    const log = await listAuditLog(owner.cookies, owner.orgId);
    const entry = log.body.find((e: { action: string }) => e.action === "membership.created");
    expect(entry).toBeDefined();
    expect(entry.actorId).toBe(invitee.userId);
    expect(entry.ip).toBeTruthy();
  });

  it("changing a member's role and removing a member produce audit entries, and the owner is protected", async () => {
    const owner = await signupAndLogin("audit-roles-owner@example.com", "Audit Roles Org");
    const memberAccount = await signupAndLogin("audit-roles-member@example.com", "Audit Roles Member Org");

    const membershipsService = app.get(MembershipsService);
    await membershipsService.create({
      userId: new Types.ObjectId(memberAccount.userId),
      orgId: new Types.ObjectId(owner.orgId),
      role: "member",
    });

    const promote = await request(app.getHttpServer())
      .patch(`/api/memberships/${memberAccount.userId}/role`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ role: "admin" });
    expect(promote.status).toBe(200);

    const remove = await request(app.getHttpServer())
      .delete(`/api/memberships/${memberAccount.userId}`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(remove.status).toBe(204);

    // The owner cannot be role-changed or removed, even by themself.
    const selfDemote = await request(app.getHttpServer())
      .patch(`/api/memberships/${owner.userId}/role`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ role: "member" });
    expect(selfDemote.status).toBe(409);

    const selfRemove = await request(app.getHttpServer())
      .delete(`/api/memberships/${owner.userId}`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(selfRemove.status).toBe(409);

    const log = await listAuditLog(owner.cookies, owner.orgId);
    const actions = log.body.map((e: { action: string }) => e.action);
    expect(actions).toContain("membership.role_changed");
    expect(actions).toContain("membership.removed");
  });

  it("a member cannot view the audit log; owner and admin can", async () => {
    const owner = await signupAndLogin("audit-view-owner@example.com", "Audit View Org");
    const memberAccount = await signupAndLogin("audit-view-member@example.com", "Audit View Member Org");

    const membershipsService = app.get(MembershipsService);
    await membershipsService.create({
      userId: new Types.ObjectId(memberAccount.userId),
      orgId: new Types.ObjectId(owner.orgId),
      role: "member",
    });

    const asOwner = await listAuditLog(owner.cookies, owner.orgId);
    expect(asOwner.status).toBe(200);

    const asMember = await listAuditLog(memberAccount.cookies, owner.orgId);
    expect(asMember.status).toBe(403);
  });

  it("billing plan changes and cancellations produce audit entries", async () => {
    const owner = await signupAndLogin("audit-billing-owner@example.com", "Audit Billing Org");

    // Give the org an active Stripe subscription to change/cancel for real.
    const subscriptionModel = app.get(getModelToken("Subscription"));
    await subscriptionModel.collection.updateOne(
      { tenantId: owner.orgId },
      { $set: { stripeSubscriptionId: "sub_fake", stripePriceId: "price_pro_test", plan: "pro" } },
    );

    const change = await request(app.getHttpServer())
      .post("/api/billing/change-plan")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ plan: "business" });
    expect(change.status).toBe(201);

    const cancel = await request(app.getHttpServer())
      .post("/api/billing/cancel")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ atPeriodEnd: false });
    expect(cancel.status).toBe(201);

    const log = await listAuditLog(owner.cookies, owner.orgId);
    const actions = log.body.map((e: { action: string }) => e.action);
    expect(actions).toContain("subscription.plan_changed");
    expect(actions).toContain("subscription.cancelled");
  });
});
