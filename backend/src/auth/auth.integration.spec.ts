import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth.module";
import { validateEnv } from "../config/env.validation";

describe("Auth flow (integration)", () => {
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
    const uri = replSet.getUri();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        MongooseModule.forRoot(uri),
        AuthModule,
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

  const signupPayload = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "correct-horse-battery",
    orgName: "Analytical Engines Inc",
  };

  it("signup creates a user, organization, and owner membership atomically", async () => {
    const res = await request(app.getHttpServer()).post("/api/auth/signup").send(signupPayload);

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(signupPayload.email);
    expect(res.body.organization.slug).toContain("analytical-engines");
    expect(res.headers["set-cookie"]).toBeDefined();
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("access_token="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("refresh_token="))).toBe(true);
  });

  it("rejects signup with a duplicate email", async () => {
    const res = await request(app.getHttpServer()).post("/api/auth/signup").send(signupPayload);
    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials and rejects wrong password", async () => {
    const good = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: signupPayload.email, password: signupPayload.password });
    expect(good.status).toBe(200);

    const bad = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: signupPayload.email, password: "wrong-password" });
    expect(bad.status).toBe(401);
  });

  it("allows an authenticated request to /me using the access token cookie", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: signupPayload.email, password: signupPayload.password });
    const cookies = extractCookieHeader(login);

    const me = await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookies);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(signupPayload.email);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0].role).toBe("owner");
  });

  it("rejects /me with no cookie", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rotates the refresh token on use and rejects reuse of the old one", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: signupPayload.email, password: signupPayload.password });
    const originalCookies = extractCookieHeader(login);

    const firstRefresh = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", originalCookies);
    expect(firstRefresh.status).toBe(200);
    const rotatedCookies = extractCookieHeader(firstRefresh);

    // Using the already-rotated (old) refresh token again must fail and revoke the session.
    const reuse = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", originalCookies);
    expect(reuse.status).toBe(401);

    // Reuse detection must also revoke the NEW token that was legitimately issued.
    const afterReuse = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", rotatedCookies);
    expect(afterReuse.status).toBe(401);
  });

  it("logout revokes the refresh token so it can no longer be used", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: signupPayload.email, password: signupPayload.password });
    const cookies = extractCookieHeader(login);

    const logout = await request(app.getHttpServer()).post("/api/auth/logout").set("Cookie", cookies);
    expect(logout.status).toBe(200);

    const refreshAfterLogout = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookies);
    expect(refreshAfterLogout.status).toBe(401);
  });
});

function extractCookieHeader(res: request.Response): string {
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}
