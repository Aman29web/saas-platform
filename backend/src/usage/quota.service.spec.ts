import { Types } from "mongoose";
import { QuotaService } from "./quota.service";
import { QuotaExceededException } from "./quota-exceeded.exception";
import { TenantContext } from "../tenancy/tenant-context";

const ORG_ID = "507f1f77bcf86cd799439011";

describe("QuotaService", () => {
  function buildService() {
    const usageService = { sumForCurrentPeriod: jest.fn(), record: jest.fn() };
    const subscriptionsService = { getForActiveOrgOrThrow: jest.fn() };
    const projectModel = { countDocuments: jest.fn(() => ({ exec: jest.fn() })) };
    const membershipModel = {
      collection: { countDocuments: jest.fn() },
      countDocuments: jest.fn(() => ({ exec: jest.fn() })),
    };

    const service = new QuotaService(
      usageService as never,
      subscriptionsService as never,
      projectModel as never,
      membershipModel as never,
    );

    return { service, usageService, subscriptionsService, projectModel, membershipModel };
  }

  function withContext<T>(fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ tenantId: "t1", userId: "u1", role: "owner" }, fn);
  }

  describe("assertProjectQuotaNotExceeded", () => {
    it("allows creation when under quota", async () => {
      const { service, subscriptionsService, projectModel } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({ plan: "free" });
      projectModel.countDocuments = jest.fn(() => ({ exec: jest.fn().mockResolvedValue(2) }));

      await expect(withContext(() => service.assertProjectQuotaNotExceeded())).resolves.toBeUndefined();
    });

    it("rejects creation at or above the free-plan project quota (3)", async () => {
      const { service, subscriptionsService, projectModel } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({ plan: "free" });
      projectModel.countDocuments = jest.fn(() => ({ exec: jest.fn().mockResolvedValue(3) }));

      await expect(withContext(() => service.assertProjectQuotaNotExceeded())).rejects.toThrow(
        QuotaExceededException,
      );
    });

    it("never checks a count for an unlimited (business) quota", async () => {
      const { service, subscriptionsService, projectModel } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({ plan: "business" });

      await withContext(() => service.assertProjectQuotaNotExceeded());
      expect(projectModel.countDocuments).not.toHaveBeenCalled();
    });

    it("throws if called with no tenant context", async () => {
      const { service } = buildService();
      await expect(service.assertProjectQuotaNotExceeded()).rejects.toThrow(/no tenant context/);
    });
  });

  describe("assertSeatQuotaNotExceededForOrg", () => {
    it("rejects at the plan's seat limit for the TARGET org, by id, with no ambient tenant context required", async () => {
      const { service, membershipModel } = buildService();
      membershipModel.collection.countDocuments.mockResolvedValue(3);

      await expect(service.assertSeatQuotaNotExceededForOrg(ORG_ID, "free")).rejects.toThrow(
        QuotaExceededException,
      );
      expect(membershipModel.collection.countDocuments).toHaveBeenCalledWith({
        orgId: new Types.ObjectId(ORG_ID),
        status: "active",
      });
    });

    it("allows under the limit", async () => {
      const { service, membershipModel } = buildService();
      membershipModel.collection.countDocuments.mockResolvedValue(1);

      await expect(service.assertSeatQuotaNotExceededForOrg(ORG_ID, "free")).resolves.toBeUndefined();
    });
  });

  describe("meterApiCallAndEnforceQuota", () => {
    it("records usage when under quota", async () => {
      const { service, subscriptionsService, usageService } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({ plan: "free" });
      usageService.sumForCurrentPeriod.mockResolvedValue(2);
      usageService.record.mockResolvedValue({});

      await withContext(() => service.meterApiCallAndEnforceQuota("key-1"));
      expect(usageService.record).toHaveBeenCalledWith("api_calls", 1, "key-1");
    });

    it("rejects at the free-plan api_calls quota (5) BEFORE recording the new event", async () => {
      const { service, subscriptionsService, usageService } = buildService();
      subscriptionsService.getForActiveOrgOrThrow.mockResolvedValue({ plan: "free" });
      usageService.sumForCurrentPeriod.mockResolvedValue(5);

      await expect(withContext(() => service.meterApiCallAndEnforceQuota())).rejects.toThrow(
        QuotaExceededException,
      );
      expect(usageService.record).not.toHaveBeenCalled();
    });
  });
});
