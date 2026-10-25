import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { MongooseModule, getModelToken } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { InvitationsModule } from "../invitations/invitations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailQueueService, type InviteEmailPayload } from "../notifications/email-queue.service";
import { UsageModule } from "./usage.module";
import { UsageService } from "./usage.service";
import { TenantContext } from "../tenancy/tenant-context";
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

describe("Usage metering & quotas (proof)", () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = "a".repeat(32);
    process.env.JWT_REFRESH_SECRET = "b".repeat(32);
    process.env.MONGO_URI = "mongodb://placeholder/placeholder";
    process.env.REDIS_URL = "redis://placeholder:6379";
    process.env.WEB_APP_URL = "http://localhost:5173";

    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        MongooseModule.forRoot(replSet.getUri()),
        ProjectsModule,
        UsageModule,
        InvitationsModule,
      ],
    })
      .overrideModule(NotificationsModule)
      .useModule(FakeNotificationsModule)
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

  it("the free-plan project quota (3) blocks the 4th project, exactly at the boundary", async () => {
    const owner = await signupAndLogin("usage-projects@example.com", "Usage Projects Org");

    for (let i = 1; i <= 3; i++) {
      const res = await request(app.getHttpServer())
        .post("/api/projects")
        .set("Cookie", owner.cookies)
        .set("X-Org-Id", owner.orgId)
        .send({ name: `project-${i}` });
      expect(res.status).toBe(201);
    }

    const fourth = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "project-4" });
    expect(fourth.status).toBe(403);
    expect(fourth.body.message).toMatch(/projects/);

    // Confirm it's really blocked, not a transient failure: still 3, not 4.
    const list = await request(app.getHttpServer())
      .get("/api/projects")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(list.body).toHaveLength(3);
  });

  it("deleting a project frees a quota slot for a new one", async () => {
    const owner = await signupAndLogin("usage-free-slot@example.com", "Usage Free Slot Org");

    const created: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const res = await request(app.getHttpServer())
        .post("/api/projects")
        .set("Cookie", owner.cookies)
        .set("X-Org-Id", owner.orgId)
        .send({ name: `p${i}` });
      created.push(res.body._id);
    }

    const blocked = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "p4" });
    expect(blocked.status).toBe(403);

    await request(app.getHttpServer())
      .delete(`/api/projects/${created[0]}`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);

    const afterFreeingSlot = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "p4-retry" });
    expect(afterFreeingSlot.status).toBe(201);
  });

  it("the usage dashboard reports accurate used/quota/remaining for every metric", async () => {
    const owner = await signupAndLogin("usage-dashboard@example.com", "Usage Dashboard Org");

    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "dashboard-project" });

    const res = await request(app.getHttpServer())
      .get("/api/usage")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("free");
    const projects = res.body.metrics.find((m: { metric: string }) => m.metric === "projects");
    expect(projects).toMatchObject({ used: 1, quota: 3, remaining: 2 });
    const apiCalls = res.body.metrics.find((m: { metric: string }) => m.metric === "api_calls");
    // One project create = one metered api_calls event.
    expect(apiCalls).toMatchObject({ used: 1, quota: 5, remaining: 4 });
    const seats = res.body.metrics.find((m: { metric: string }) => m.metric === "seats");
    expect(seats).toMatchObject({ used: 1, quota: 3, remaining: 2 });
  });

  it("metering is idempotent: recording the same event twice with the same key counts once", async () => {
    const owner = await signupAndLogin("usage-idempotent@example.com", "Usage Idempotent Org");
    const usageService = app.get(UsageService);

    await TenantContext.run({ tenantId: owner.orgId, userId: "test", role: "owner" }, async () => {
      await usageService.record("api_calls", 1, "same-key");
      await usageService.record("api_calls", 1, "same-key");
      await usageService.record("api_calls", 1, "same-key");
      const total = await usageService.sumForCurrentPeriod("api_calls");
      expect(total).toBe(1);
    });
  });

  it("the rollup job aggregates raw UsageRecord entries into an accurate per-metric total", async () => {
    const owner = await signupAndLogin("usage-rollup@example.com", "Usage Rollup Org");
    const usageService = app.get(UsageService);

    await TenantContext.run({ tenantId: owner.orgId, userId: "test", role: "owner" }, async () => {
      await usageService.record("api_calls", 1);
      await usageService.record("api_calls", 1);
      await usageService.record("api_calls", 1);
      await usageService.rollupCurrentPeriod();
    });

    const rollupModel = app.get(getModelToken("UsageRollup"));
    const rollup = await rollupModel.collection.findOne({ tenantId: owner.orgId, metric: "api_calls" });
    expect(rollup?.total).toBe(3);
  });

  function extractToken(acceptUrl: string): string {
    return new URL(acceptUrl).searchParams.get("token")!;
  }

  it("the free-plan seat quota (3) blocks accepting a 4th invitation", async () => {
    const owner = await signupAndLogin("usage-seats-owner@example.com", "Usage Seats Org");

    // Owner already occupies 1 seat; invite and accept 2 more to reach 3.
    for (let i = 1; i <= 2; i++) {
      sentEmails.length = 0;
      const invitee = await signupAndLogin(`usage-seats-member-${i}@example.com`, `Usage Seats Member ${i} Org`);
      await request(app.getHttpServer())
        .post("/api/invitations")
        .set("Cookie", owner.cookies)
        .set("X-Org-Id", owner.orgId)
        .send({ email: `usage-seats-member-${i}@example.com`, role: "member" });

      const token = extractToken(sentEmails[0].acceptUrl);
      const accept = await request(app.getHttpServer())
        .post("/api/invitations/public/accept")
        .set("Cookie", invitee.cookies)
        .send({ token });
      expect(accept.status).toBe(201);
    }

    // A 4th accepted membership would exceed the free-plan seat quota (3).
    sentEmails.length = 0;
    const fourthInvitee = await signupAndLogin("usage-seats-member-3@example.com", "Usage Seats Member 3 Org");
    await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "usage-seats-member-3@example.com", role: "member" });

    const token = extractToken(sentEmails[0].acceptUrl);
    const blocked = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", fourthInvitee.cookies)
      .send({ token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/seats/);
  });
});
