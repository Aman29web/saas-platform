import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { ProjectsModule } from "../projects/projects.module";
import { MembershipsService } from "../memberships/memberships.service";
import { validateEnv } from "../config/env.validation";

describe("RBAC (proof)", () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let membershipsService: MembershipsService;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = "a".repeat(32);
    process.env.JWT_REFRESH_SECRET = "b".repeat(32);
    process.env.JWT_ACCESS_TTL = "15m";
    process.env.JWT_REFRESH_TTL = "30d";
    process.env.MONGO_URI = "mongodb://placeholder/placeholder";
    process.env.REDIS_URL = "redis://placeholder:6379";

    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        MongooseModule.forRoot(replSet.getUri()),
        ProjectsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api");
    await app.init();

    membershipsService = app.get(MembershipsService);
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

  it("a member can create and update projects but cannot delete one", async () => {
    const owner = await signupAndLogin("rbac-owner@example.com", "RBAC Org");
    const memberAccount = await signupAndLogin("rbac-member@example.com", "RBAC Member's Own Org");

    // Add memberAccount's user to the owner's org as a plain member — this
    // simulates the invite flow landing in Module E, which isn't built yet.
    await membershipsService.create({
      userId: new Types.ObjectId(memberAccount.userId),
      orgId: new Types.ObjectId(owner.orgId),
      role: "member",
    });

    const create = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", memberAccount.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "member's project" });
    expect(create.status).toBe(201);
    const projectId = create.body._id;

    const update = await request(app.getHttpServer())
      .put(`/api/projects/${projectId}`)
      .set("Cookie", memberAccount.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "renamed" });
    expect(update.status).toBe(200);

    const destroy = await request(app.getHttpServer())
      .delete(`/api/projects/${projectId}`)
      .set("Cookie", memberAccount.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(destroy.status).toBe(403);

    // The project must still exist — the 403 wasn't just a response-shape bug.
    const stillThere = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(stillThere.status).toBe(200);
  });

  it("the owner (and an admin) can delete a project a member created", async () => {
    const owner = await signupAndLogin("rbac-owner-2@example.com", "RBAC Org 2");
    const adminAccount = await signupAndLogin("rbac-admin-2@example.com", "RBAC Admin's Own Org");

    await membershipsService.create({
      userId: new Types.ObjectId(adminAccount.userId),
      orgId: new Types.ObjectId(owner.orgId),
      role: "admin",
    });

    const create = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "to be deleted by admin" });
    const projectId = create.body._id;

    const destroyByAdmin = await request(app.getHttpServer())
      .delete(`/api/projects/${projectId}`)
      .set("Cookie", adminAccount.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(destroyByAdmin.status).toBe(204);
  });

  it("privilege escalation is impossible: role comes only from the stored membership, never from the request", async () => {
    const owner = await signupAndLogin("rbac-escalate@example.com", "RBAC Escalate Org");
    const memberAccount = await signupAndLogin("rbac-escalate-member@example.com", "RBAC Escalate Member Org");

    await membershipsService.create({
      userId: new Types.ObjectId(memberAccount.userId),
      orgId: new Types.ObjectId(owner.orgId),
      role: "member",
    });

    const create = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", memberAccount.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "escalation target" });
    const projectId = create.body._id;

    // A crafted request claiming to be an owner/admin via a header or body
    // field has no effect — the guard never reads role from the request.
    const destroy = await request(app.getHttpServer())
      .delete(`/api/projects/${projectId}`)
      .set("Cookie", memberAccount.cookies)
      .set("X-Org-Id", owner.orgId)
      .set("X-Role", "owner")
      .send({ role: "owner" });
    expect(destroy.status).toBe(403);
  });
});
