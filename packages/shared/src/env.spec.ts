import { describe, expect, it } from "vitest";
import { apiEnvSchema } from "./env";

describe("apiEnvSchema", () => {
  const base = {
    MONGO_URI: "mongodb://localhost:27017/test",
    REDIS_URL: "redis://localhost:6379",
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
  };

  it("applies defaults for optional fields", () => {
    const result = apiEnvSchema.parse(base);
    expect(result.NODE_ENV).toBe("development");
    expect(result.PORT).toBe(4000);
    expect(result.EMAIL_FROM).toBe("no-reply@example.com");
  });

  it("rejects a JWT secret under 32 characters", () => {
    expect(() =>
      apiEnvSchema.parse({ ...base, JWT_ACCESS_SECRET: "too-short" }),
    ).toThrow();
  });
});
