import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { tenantScopePlugin } from "../../tenancy/tenant-scope.plugin";
import { USAGE_METRICS, type UsageMetric } from "../../common/enums";

/**
 * Pre-aggregated per (tenant, metric, period) so the usage dashboard reads
 * one row instead of summing every raw UsageRecord on every request.
 * Written only by UsageRollupProcessor; always derivable by re-aggregating
 * UsageRecord, so it's a cache, not a second source of truth.
 */
@Schema({ timestamps: true, collection: "usage_rollups" })
export class UsageRollup {
  _id!: Types.ObjectId;

  // Stamped automatically by tenantScopePlugin — never set this by hand.
  @Prop({ required: true, index: true })
  tenantId!: string;

  @Prop({ required: true, enum: USAGE_METRICS })
  metric!: UsageMetric;

  @Prop({ required: true })
  periodStart!: Date;

  @Prop({ required: true, default: 0 })
  total!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UsageRollupDocument = UsageRollup & Document;
export const UsageRollupSchema = SchemaFactory.createForClass(UsageRollup);
UsageRollupSchema.index({ tenantId: 1, metric: 1, periodStart: 1 }, { unique: true });
UsageRollupSchema.plugin(tenantScopePlugin);
