import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { UsageRecord, UsageRecordDocument } from "./schemas/usage-record.schema";
import { UsageRollup, UsageRollupDocument } from "./schemas/usage-rollup.schema";
import { currentPeriodStart } from "./period";
import type { UsageMetric } from "../common/enums";

@Injectable()
export class UsageService {
  constructor(
    @InjectModel(UsageRecord.name) private readonly usageRecordModel: Model<UsageRecordDocument>,
    @InjectModel(UsageRollup.name) private readonly usageRollupModel: Model<UsageRollupDocument>,
  ) {}

  /**
   * Idempotent via the unique (tenantId, idempotencyKey) index: a caller
   * that retries the same logical event with the same key gets the
   * original record back instead of double-counting usage. Same
   * claim-before-effect shape as WebhookEvent (Module G) — relying on the
   * unique index to reject a duplicate concurrently, not a racy
   * check-then-insert.
   */
  async record(metric: UsageMetric, quantity: number, idempotencyKey?: string): Promise<UsageRecordDocument> {
    if (!idempotencyKey) {
      return this.usageRecordModel.create({ metric, quantity, periodStart: currentPeriodStart() });
    }

    try {
      return await this.usageRecordModel.create({
        metric,
        quantity,
        periodStart: currentPeriodStart(),
        idempotencyKey,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const existing = await this.usageRecordModel.findOne({ idempotencyKey }).exec();
        if (existing) return existing;
      }
      throw err;
    }
  }

  async sumForCurrentPeriod(metric: UsageMetric): Promise<number> {
    const result = await this.usageRecordModel
      .aggregate<{ total: number }>([
        { $match: { metric, periodStart: currentPeriodStart() } },
        { $group: { _id: null, total: { $sum: "$quantity" } } },
      ])
      .exec();
    return result[0]?.total ?? 0;
  }

  async getRollupsForCurrentPeriod(): Promise<UsageRollupDocument[]> {
    return this.usageRollupModel.find({ periodStart: currentPeriodStart() }).exec();
  }

  /** Called by UsageRollupProcessor, always within an established TenantContext. */
  async rollupCurrentPeriod(): Promise<void> {
    const periodStart = currentPeriodStart();
    const totals = await this.usageRecordModel
      .aggregate<{ _id: UsageMetric; total: number }>([
        { $match: { periodStart } },
        { $group: { _id: "$metric", total: { $sum: "$quantity" } } },
      ])
      .exec();

    for (const { _id: metric, total } of totals) {
      await this.usageRollupModel
        .findOneAndUpdate({ metric, periodStart }, { $set: { total } }, { upsert: true })
        .exec();
    }
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 11000;
}
