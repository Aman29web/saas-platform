import { quotaFor } from "./quotas";

describe("quotaFor", () => {
  it("free plan has small, finite limits on every metric", () => {
    expect(quotaFor("free", "projects")).toBe(3);
    expect(quotaFor("free", "seats")).toBe(3);
    expect(quotaFor("free", "api_calls")).toBe(5);
    expect(quotaFor("free", "storage_mb")).toBe(100);
  });

  it("business plan has unlimited projects and seats but a finite api_calls cap", () => {
    expect(quotaFor("business", "projects")).toBeNull();
    expect(quotaFor("business", "seats")).toBeNull();
    expect(quotaFor("business", "api_calls")).toBe(1_000_000);
  });

  it("pro sits between free and business on every metric", () => {
    expect(quotaFor("pro", "projects")).toBeGreaterThan(quotaFor("free", "projects")!);
    expect(quotaFor("pro", "api_calls")).toBeLessThan(quotaFor("business", "api_calls")!);
  });
});
