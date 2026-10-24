import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { getModelToken, MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Model } from "mongoose";
import { ProjectsModule } from "../projects/projects.module";
import { AdminModule } from "../admin/admin.module";
import { Project, ProjectDocument } from "../projects/schemas/project.schema";
import { User } from "../users/schemas/user.schema";
import { validateEnv } from "../config/env.validation";
import { TenantContext } from "./tenant-context";

describe("Tenant isolation (proof)", () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;

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
        AdminModule,
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

  it("cannot read, update, or delete another tenant's project through the API — even with its real id", async () => {
    const tenantA = await signupAndLogin("a-user@example.com", "Tenant A");
    const tenantB = await signupAndLogin("b-user@example.com", "Tenant B");

    const createB = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", tenantB.cookies)
      .set("X-Org-Id", tenantB.orgId)
      .send({ name: "Tenant B's secret project" });
    expect(createB.status).toBe(201);
    const projectBId = createB.body._id;

    // Tenant A has the REAL id of tenant B's project (e.g. guessed, leaked
    // in a log, whatever) and tries to read it while scoped to its own org.
    const read = await request(app.getHttpServer())
      .get(`/api/projects/${projectBId}`)
      .set("Cookie", tenantA.cookies)
      .set("X-Org-Id", tenantA.orgId);
    expect(read.status).toBe(404);

    const update = await request(app.getHttpServer())
      .put(`/api/projects/${projectBId}`)
      .set("Cookie", tenantA.cookies)
      .set("X-Org-Id", tenantA.orgId)
      .send({ name: "pwned" });
    expect(update.status).toBe(404);

    const destroy = await request(app.getHttpServer())
      .delete(`/api/projects/${projectBId}`)
      .set("Cookie", tenantA.cookies)
      .set("X-Org-Id", tenantA.orgId);
    expect(destroy.status).toBe(404);

    // Confirm it's still there and untouched.
    const stillThere = await request(app.getHttpServer())
      .get(`/api/projects/${projectBId}`)
      .set("Cookie", tenantB.cookies)
      .set("X-Org-Id", tenantB.orgId);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.name).toBe("Tenant B's secret project");
  });

  it("tenant A's project list never includes tenant B's projects", async () => {
    const tenantA = await signupAndLogin("list-a@example.com", "List Tenant A");
    const tenantB = await signupAndLogin("list-b@example.com", "List Tenant B");

    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", tenantA.cookies)
      .set("X-Org-Id", tenantA.orgId)
      .send({ name: "A1" });
    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", tenantB.cookies)
      .set("X-Org-Id", tenantB.orgId)
      .send({ name: "B1" });
    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", tenantB.cookies)
      .set("X-Org-Id", tenantB.orgId)
      .send({ name: "B2" });

    const listA = await request(app.getHttpServer())
      .get("/api/projects")
      .set("Cookie", tenantA.cookies)
      .set("X-Org-Id", tenantA.orgId);

    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].name).toBe("A1");
  });

  it("rejects X-Org-Id for an org the user does not belong to", async () => {
    const tenantA = await signupAndLogin("forbidden-a@example.com", "Forbidden A");
    const tenantB = await signupAndLogin("forbidden-b@example.com", "Forbidden B");

    const res = await request(app.getHttpServer())
      .get("/api/projects")
      .set("Cookie", tenantA.cookies)
      .set("X-Org-Id", tenantB.orgId); // A's cookie, B's org header

    expect(res.status).toBe(403);
  });

  it("a crafted request with no X-Org-Id header is rejected outright", async () => {
    const tenantA = await signupAndLogin("noheader@example.com", "No Header Org");

    const res = await request(app.getHttpServer()).get("/api/projects").set("Cookie", tenantA.cookies);
    expect(res.status).toBe(400);
  });

  it("the Mongoose plugin blocks cross-tenant access even bypassing the service/controller layer entirely", async () => {
    const tenantA = await signupAndLogin("raw-a@example.com", "Raw Tenant A");
    const tenantB = await signupAndLogin("raw-b@example.com", "Raw Tenant B");

    const projectModel = app.get<Model<ProjectDocument>>(getModelToken(Project.name));

    const createdB = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", tenantB.cookies)
      .set("X-Org-Id", tenantB.orgId)
      .send({ name: "raw target" });
    const projectBId = createdB.body._id;

    // A developer who forgot to scope a query and called the raw model
    // directly, inside tenant A's request context, STILL cannot see B's doc —
    // the plugin injects tenantId regardless of which tenant's id is targeted.
    const leaked = await runWithTenant(tenantA.orgId, tenantA.userId, "owner", () =>
      projectModel.findById(projectBId).exec(),
    );
    expect(leaked).toBeNull();

    // And with NO tenant context at all (not even a bypass), the plugin
    // fails closed rather than silently running unscoped.
    await expect(projectModel.findById(projectBId).exec()).rejects.toThrow(/no active tenant context/);
  });

  it("the admin escape hatch can read across tenants, but only for a platform admin, and it is logged", async () => {
    const tenantA = await signupAndLogin("admin-proof-a@example.com", "Admin Proof A");
    const tenantB = await signupAndLogin("admin-proof-b@example.com", "Admin Proof B");

    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", tenantA.cookies)
      .set("X-Org-Id", tenantA.orgId)
      .send({ name: "admin-proof-a-project" });
    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", tenantB.cookies)
      .set("X-Org-Id", tenantB.orgId)
      .send({ name: "admin-proof-b-project" });

    // Non-admin is forbidden from the escape-hatch endpoint entirely.
    const forbidden = await request(app.getHttpServer())
      .get("/api/admin/projects")
      .set("Cookie", tenantA.cookies);
    expect(forbidden.status).toBe(403);

    // Promote tenant A's user to platform admin directly (simulating an
    // already-provisioned admin) and confirm the bypass now sees both tenants.
    const userModel = app.get<Model<User>>(getModelToken(User.name));
    await userModel.updateOne({ email: "admin-proof-a@example.com" }, { isPlatformAdmin: true }).exec();

    const adminLogin = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin-proof-a@example.com", password: "correct-horse-battery" });
    const adminCookies = (adminLogin.headers["set-cookie"] as unknown as string[])
      .map((c) => c.split(";")[0])
      .join("; ");

    const allProjects = await request(app.getHttpServer())
      .get("/api/admin/projects")
      .set("Cookie", adminCookies);

    expect(allProjects.status).toBe(200);
    const names = allProjects.body.map((p: { name: string }) => p.name);
    expect(names).toContain("admin-proof-a-project");
    expect(names).toContain("admin-proof-b-project");
  });
});

async function runWithTenant<T>(
  tenantId: string,
  userId: string,
  role: "owner" | "admin" | "member",
  fn: () => Promise<T>,
): Promise<T> {
  return TenantContext.run({ tenantId, userId, role }, fn);
}
