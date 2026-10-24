import { validateEnv } from "./env.validation";

describe("validateEnv", () => {
  const validConfig = {
    NODE_ENV: "test",
    PORT: "4000",
    MONGO_URI: "mongodb://localhost:27017/test",
    REDIS_URL: "redis://localhost:6379",
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
  };

  it("accepts a valid configuration and coerces types", () => {
    const result = validateEnv(validConfig);
    expect(result.PORT).toBe(4000);
    expect(result.MONGO_URI).toBe(validConfig.MONGO_URI);
  });

  it("throws when a required var is missing", () => {
    const rest = { ...validConfig };
    delete (rest as Partial<typeof validConfig>).MONGO_URI;
    expect(() => validateEnv(rest)).toThrow(/MONGO_URI/);
  });

  it("throws when a secret is too short", () => {
    expect(() =>
      validateEnv({ ...validConfig, JWT_ACCESS_SECRET: "short" }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: "bogus" })).toThrow();
  });
});
