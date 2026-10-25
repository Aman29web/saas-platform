import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { tenantScopePlugin } from "../../tenancy/tenant-scope.plugin";
import { USAGE_METRICS, type UsageMetric } from "../../common/enums";

/**
 * Append-only: no update/delete methods are exposed anywhere in
 * UsageService. Billing-adjacent records should never be mutated after
 * the fact — a correction is a new record, not an edited one.
 */
@Schema({ timestamps: true, collection: "usage_records" })
export class UsageRecord {
  _id!: Types.ObjectId;

  // Stamped automatically by tenantScopePlugin — never set this by hand.
  @Prop({ required: true, index: true })
  tenantId!: string;

  @Prop({ required: true, enum: USAGE_METRICS })
  metric!: UsageMetric;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ required: true })
  periodStart!: Date;

  @Prop()
  idempotencyKey?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UsageRecordDocument = UsageRecord & Document;
export const UsageRecordSchema = SchemaFactory.createForClass(UsageRecord);
UsageRecordSchema.index({ tenantId: 1, metric: 1, periodStart: 1 });
// A sparse compound index would still collide here: Mongo's sparse
// semantics only skip a document when EVERY indexed field is missing, and
// tenantId is always present. A partial index with an explicit filter is
// what actually excludes documents with no idempotencyKey.
UsageRecordSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
);
UsageRecordSchema.plugin(tenantScopePlugin);
