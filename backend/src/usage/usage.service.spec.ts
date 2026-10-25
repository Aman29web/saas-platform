import { UsageService } from "./usage.service";

describe("UsageService.record", () => {
  function buildService() {
    const usageRecordModel = {
      create: jest.fn(),
      findOne: jest.fn(() => ({ exec: jest.fn() })),
    };
    const usageRollupModel = {};
    const service = new UsageService(usageRecordModel as never, usageRollupModel as never);
    return { service, usageRecordModel };
  }

  it("records a new event with no idempotency key every time", async () => {
    const { service, usageRecordModel } = buildService();
    usageRecordModel.create.mockResolvedValue({ _id: "a" });

    await service.record("api_calls", 1);
    await service.record("api_calls", 1);

    expect(usageRecordModel.create).toHaveBeenCalledTimes(2);
  });

  it("is idempotent for a repeated idempotency key: second call returns the first record, no duplicate insert error surfaced", async () => {
    const { service, usageRecordModel } = buildService();
    const firstRecord = { _id: "first", idempotencyKey: "evt-1" };
    usageRecordModel.create.mockResolvedValueOnce(firstRecord).mockRejectedValueOnce({ code: 11000 });
    usageRecordModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(firstRecord) });

    const first = await service.record("api_calls", 1, "evt-1");
    const second = await service.record("api_calls", 1, "evt-1");

    expect(first).toBe(firstRecord);
    expect(second).toBe(firstRecord);
    expect(usageRecordModel.create).toHaveBeenCalledTimes(2);
  });

  it("propagates a non-duplicate-key error", async () => {
    const { service, usageRecordModel } = buildService();
    usageRecordModel.create.mockRejectedValue(new Error("disk full"));

    await expect(service.record("api_calls", 1, "evt-2")).rejects.toThrow("disk full");
  });
});
