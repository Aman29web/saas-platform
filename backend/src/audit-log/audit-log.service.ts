import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { AuditLog, AuditLogDocument } from "./schemas/audit-log.schema";
import { TenantContext } from "../tenancy/tenant-context";

export interface AuditLogFilter {
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class AuditLogService {
  constructor(@InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLogDocument>) {}

  /**
   * actorId, impersonatorId, tenantId, and ip all come from the ambient
   * TenantContext rather than being passed in by every call site — the
   * same reasoning as tenantScopePlugin stamping tenantId automatically:
   * a developer writing a new sensitive action should not be able to
   * forget who did it or from where.
   */
  async record(action: string, targetType: string, targetId?: string, metadata?: Record<string, unknown>) {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("AuditLogService.record called with no tenant context");

    return this.auditLogModel.create({
      actorId: new Types.ObjectId(ctx.userId),
      impersonatorId: ctx.impersonatorId ? new Types.ObjectId(ctx.impersonatorId) : undefined,
      action,
      targetType,
      targetId,
      metadata,
      ip: ctx.ip,
    });
  }

  async findForActiveOrg(filter: AuditLogFilter = {}) {
    const query: Record<string, unknown> = {};
    if (filter.action) query.action = filter.action;
    if (filter.actorId) query.actorId = new Types.ObjectId(filter.actorId);
    if (filter.from || filter.to) {
      query.createdAt = {
        ...(filter.from ? { $gte: filter.from } : {}),
        ...(filter.to ? { $lte: filter.to } : {}),
      };
    }

    return this.auditLogModel.find(query).sort({ createdAt: -1 }).limit(200).exec();
  }
}
