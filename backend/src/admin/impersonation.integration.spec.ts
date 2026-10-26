import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { MongooseModule, getModelToken } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { AdminModule } from "./admin.module";
import { ProjectsModule } from "../projects/projects.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { User } from "../users/schemas/user.schema";
import { validateEnv } from "../config/env.validation";

describe("Admin impersonation (proof)", () => {
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
        AdminModule,
        ProjectsModule,
        AuditLogModule,
      ],
    }).compile();

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

  async function makePlatformAdmin(email: string) {
    const userModel = app.get(getModelToken(User.name));
    await userModel.updateOne({ email }, { isPlatformAdmin: true }).exec();
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "correct-horse-battery" });
    return (login.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  }

  function extractCookie(res: request.Response, name: string): string | undefined {
    const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    const match = setCookie.find((c) => c.startsWith(`${name}=`));
    return match?.split(";")[0];
  }

  it("a non-admin cannot start impersonation", async () => {
    const admin = await signupAndLogin("imp-nonadmin@example.com", "Imp NonAdmin Org");
    const target = await signupAndLogin("imp-target-0@example.com", "Imp Target Org 0");

    const res = await request(app.getHttpServer())
      .post(`/api/admin/impersonate/${target.userId}/${target.orgId}`)
      .set("Cookie", admin.cookies);
    expect(res.status).toBe(403);
  });

  it("a platform admin can impersonate a member of a target org, and acts with that member's role", async () => {
    await signupAndLogin("imp-admin-1@example.com", "Imp Admin Org 1");
    const target = await signupAndLogin("imp-target-1@example.com", "Imp Target Org 1");
    const adminCookies = await makePlatformAdmin("imp-admin-1@example.com");

    const start = await request(app.getHttpServer())
      .post(`/api/admin/impersonate/${target.userId}/${target.orgId}`)
      .set("Cookie", adminCookies);
    expect(start.status).toBe(200);
    expect(start.body.impersonating).toBe("imp-target-1@example.com");

    const impersonationAccessToken = extractCookie(start, "access_token");
    const adminAccessTokenStash = extractCookie(start, "admin_access_token");
    expect(impersonationAccessToken).toBeDefined();
    expect(adminAccessTokenStash).toBeDefined();

    // Acting as the target user (owner of their own org) within their org.
    const createProject = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", `${impersonationAccessToken}`)
      .set("X-Org-Id", target.orgId)
      .send({ name: "created while impersonated" });
    expect(createProject.status).toBe(201);

    const auditLog = await request(app.getHttpServer())
      .get("/api/audit-log")
      .set("Cookie", `${impersonationAccessToken}`)
      .set("X-Org-Id", target.orgId);
    const startedEntry = auditLog.body.find((e: { action: string }) => e.action === "impersonation.started");
    expect(startedEntry).toBeDefined();
    expect(startedEntry.actorId).toBe(target.userId);
  });

  it("destructive actions are blocked while impersonating, even though the target is the org's owner", async () => {
    const adminCookies = await (async () => {
      await signupAndLogin("imp-admin-2@example.com", "Imp Admin Org 2");
      return makePlatformAdmin("imp-admin-2@example.com");
    })();
    const target = await signupAndLogin("imp-target-2@example.com", "Imp Target Org 2");

    const start = await request(app.getHttpServer())
      .post(`/api/admin/impersonate/${target.userId}/${target.orgId}`)
      .set("Cookie", adminCookies);
    const impersonationAccessToken = extractCookie(start, "access_token");

    const create = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", `${impersonationAccessToken}`)
      .set("X-Org-Id", target.orgId)
      .send({ name: "to delete" });
    const projectId = create.body._id;

    // Target is the owner, who normally CAN delete projects (projects:delete)
    // — but not while being impersonated.
    const destroy = await request(app.getHttpServer())
      .delete(`/api/projects/${projectId}`)
      .set("Cookie", `${impersonationAccessToken}`)
      .set("X-Org-Id", target.orgId);
    expect(destroy.status).toBe(403);
    expect(destroy.body.message).toMatch(/impersonating/);

    // Non-destructive actions still work normally.
    const update = await request(app.getHttpServer())
      .put(`/api/projects/${projectId}`)
      .set("Cookie", `${impersonationAccessToken}`)
      .set("X-Org-Id", target.orgId)
      .send({ name: "renamed" });
    expect(update.status).toBe(200);
  });

  it("exiting impersonation restores the admin's own session", async () => {
    await signupAndLogin("imp-admin-3@example.com", "Imp Admin Org 3");
    const adminCookies = await makePlatformAdmin("imp-admin-3@example.com");
    const target = await signupAndLogin("imp-target-3@example.com", "Imp Target Org 3");

    const start = await request(app.getHttpServer())
      .post(`/api/admin/impersonate/${target.userId}/${target.orgId}`)
      .set("Cookie", adminCookies);
    const impersonationAccessToken = extractCookie(start, "access_token")!;
    const adminAccessTokenStash = extractCookie(start, "admin_access_token")!;

    const exit = await request(app.getHttpServer())
      .post("/api/admin/impersonate/exit")
      .set("Cookie", `${impersonationAccessToken}; ${adminAccessTokenStash}`)
      .send({ orgId: target.orgId });
    expect(exit.status).toBe(200);

    const restoredAccessToken = extractCookie(exit, "access_token")!;
    expect(restoredAccessToken).toBeDefined();

    // The restored cookie authenticates as the admin again, with full
    // platform-admin access — not as the impersonated target.
    const adminProjects = await request(app.getHttpServer())
      .get("/api/admin/projects")
      .set("Cookie", restoredAccessToken);
    expect(adminProjects.status).toBe(200);

    // admin_access_token should be cleared after exit.
    const clearedCookie = (exit.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("admin_access_token="),
    );
    expect(clearedCookie).toMatch(/admin_access_token=;/);
  });

  it("exit fails with no stashed admin session (not currently impersonating)", async () => {
    const res = await request(app.getHttpServer()).post("/api/admin/impersonate/exit").send({});
    expect(res.status).toBe(401);
  });

  it("cannot impersonate a user who isn't a member of the target org", async () => {
    await signupAndLogin("imp-admin-4@example.com", "Imp Admin Org 4");
    const adminCookies = await makePlatformAdmin("imp-admin-4@example.com");
    const unrelatedUser = await signupAndLogin("imp-unrelated-4@example.com", "Imp Unrelated Org 4");
    const someOtherOrg = await signupAndLogin("imp-other-org-4@example.com", "Imp Other Org 4");

    const res = await request(app.getHttpServer())
      .post(`/api/admin/impersonate/${unrelatedUser.userId}/${someOtherOrg.orgId}`)
      .set("Cookie", adminCookies);
    expect(res.status).toBe(404);
  });
});
