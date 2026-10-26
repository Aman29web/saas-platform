import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { AuthModule } from "../auth/auth.module";
import { validateEnv } from "../config/env.validation";

// Mirrors the slice of AppModule's wiring this test actually needs
// (ThrottlerModule.forRoot + the global APP_GUARD) — narrow test module
// graphs elsewhere don't import AppModule itself, so throttling is
// otherwise inert in those suites by design (see AppModule's comment).
@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] })],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ThrottlingTestModule {}

describe("Rate limiting (proof)", () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = "a".repeat(32);
    process.env.JWT_REFRESH_SECRET = "b".repeat(32);
    process.env.MONGO_URI = "mongodb://placeholder/placeholder";
    process.env.REDIS_URL = "redis://placeholder:6379";

    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        MongooseModule.forRoot(replSet.getUri()),
        ThrottlingTestModule,
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

  it("the 11th login attempt within a minute is rate-limited (429), not just rejected on credentials", async () => {
    const results = [];
    for (let i = 0; i < 11; i++) {
      results.push(
        await request(app.getHttpServer())
          .post("/api/auth/login")
          .send({ email: `nobody-${i}@example.com`, password: "wrong" }),
      );
    }

    const statuses = results.map((r) => r.status);
    // First 10 are genuine auth failures (401); the 11th is throttled (429).
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("signup is independently rate-limited from login", async () => {
    const results = [];
    for (let i = 0; i < 11; i++) {
      results.push(
        await request(app.getHttpServer()).post("/api/auth/signup").send({
          name: "User",
          email: `throttle-signup-${i}@example.com`,
          password: "correct-horse-battery",
          orgName: `Throttle Org ${i}`,
        }),
      );
    }

    const statuses = results.map((r) => r.status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
