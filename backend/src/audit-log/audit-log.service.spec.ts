import { AuditLogService } from "./audit-log.service";
import { TenantContext } from "../tenancy/tenant-context";

describe("AuditLogService", () => {
  function buildService() {
    const auditLogModel = { create: jest.fn(), find: jest.fn() };
    const service = new AuditLogService(auditLogModel as never);
    return { service, auditLogModel };
  }

  it("throws when called with no tenant context", async () => {
    const { service } = buildService();
    await expect(service.record("x", "y")).rejects.toThrow(/no tenant context/);
  });

  it("pulls actor, impersonator, and ip from the ambient TenantContext, not from the caller", async () => {
    const { service, auditLogModel } = buildService();
    auditLogModel.create.mockResolvedValue({});

    const userId = "507f1f77bcf86cd799439011";
    const adminId = "507f1f77bcf86cd799439012";
    await TenantContext.run(
      { tenantId: "t1", userId, role: "owner", impersonatorId: adminId, ip: "1.2.3.4" },
      () => service.record("invitation.created", "invitation", "inv1", { email: "a@b.com" }),
    );

    expect(auditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "invitation.created",
        targetType: "invitation",
        targetId: "inv1",
        metadata: { email: "a@b.com" },
        ip: "1.2.3.4",
      }),
    );
  });

  it("omits impersonatorId entirely when not impersonating", async () => {
    const { service, auditLogModel } = buildService();
    auditLogModel.create.mockResolvedValue({});

    await TenantContext.run({ tenantId: "t1", userId: "507f1f77bcf86cd799439011", role: "owner" }, () =>
      service.record("x", "y"),
    );

    const call = auditLogModel.create.mock.calls[0][0];
    expect(call.impersonatorId).toBeUndefined();
  });
});
