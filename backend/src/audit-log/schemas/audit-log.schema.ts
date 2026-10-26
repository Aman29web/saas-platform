import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema, Types } from "mongoose";
import { tenantScopePlugin } from "../../tenancy/tenant-scope.plugin";

/**
 * Append-only: AuditLogService exposes no update/delete methods, and
 * neither does any controller. A correction is a new entry, not an edited
 * one — the whole point of an audit trail is that it cannot be quietly
 * rewritten after the fact.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: "audit_logs" })
export class AuditLog {
  _id!: Types.ObjectId;

  // Stamped automatically by tenantScopePlugin — never set this by hand.
  @Prop({ required: true, index: true })
  tenantId!: string;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: "User" })
  actorId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "User" })
  impersonatorId?: Types.ObjectId;

  @Prop({ required: true })
  action!: string;

  @Prop({ required: true })
  targetType!: string;

  @Prop()
  targetId?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop()
  ip?: string;

  createdAt!: Date;
}

export type AuditLogDocument = AuditLog & Document;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, action: 1, createdAt: -1 });
AuditLogSchema.plugin(tenantScopePlugin);
