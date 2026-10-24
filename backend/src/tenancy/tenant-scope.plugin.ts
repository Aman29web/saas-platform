import type { Schema, Query, Document, Aggregate } from "mongoose";
import { TenantContext } from "./tenant-context";
import { getTenantBypassContext } from "./tenant-bypass";

/**
 * Enforces tenant isolation at the data-access layer instead of relying on
 * every service method to remember a `{ tenantId }` filter.
 *
 * - Every find/update/delete/count query gets `tenantId` injected from the
 *   request-scoped TenantContext, UNLESS an explicit, logged bypass
 *   (see tenant-bypass.ts) is active for the current async context.
 * - Every new document gets `tenantId` stamped from the context on save.
 * - If neither a tenant context nor a bypass is active, every operation
 *   throws instead of silently running unscoped. Fail closed, not open.
 */
export function tenantScopePlugin(schema: Schema): void {
  const queryMiddleware = [
    "find",
    "findOne",
    "findOneAndUpdate",
    "findOneAndDelete",
    "findOneAndRemove",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "countDocuments",
  ] as const;

  for (const op of queryMiddleware) {
    // mongoose's pre() overloads don't accept a dynamic string union even
    // though every value here is a valid hook name at runtime.
    (schema.pre as (op: string, fn: (this: Query<unknown, Document>) => void) => void)(op, function (
      this: Query<unknown, Document>,
    ) {
      if (getTenantBypassContext()) return;

      const tenantId = TenantContext.getTenantId();
      if (!tenantId) {
        throw new Error(
          `Tenant-scoped query (${op}) attempted with no active tenant context and no bypass. ` +
            "This is a bug, not a permissions gap — fix the caller.",
        );
      }

      this.where({ tenantId });
    });
  }

  schema.pre("aggregate", function (this: Aggregate<unknown>) {
    if (getTenantBypassContext()) return;

    const tenantId = TenantContext.getTenantId();
    if (!tenantId) {
      throw new Error(
        "Tenant-scoped aggregate attempted with no active tenant context and no bypass. " +
          "This is a bug, not a permissions gap — fix the caller.",
      );
    }

    this.pipeline().unshift({ $match: { tenantId } });
  });

  // pre('validate'), not pre('save'): required-field validation runs BEFORE
  // save middleware, so stamping tenantId in pre('save') is always too late
  // — the document fails `tenantId is required` before the hook ever runs.
  schema.pre("validate", function (this: Document & { tenantId?: string; isNew: boolean }) {
    if (!this.isNew) return;
    if (this.tenantId) return; // already set explicitly (e.g. by an admin backfill job)

    if (getTenantBypassContext()) {
      throw new Error(
        "Cannot create a tenant-scoped document inside a bypass context without an explicit tenantId. " +
          "Admin bypass is for reading across tenants, not writing without one.",
      );
    }

    const tenantId = TenantContext.getTenantId();
    if (!tenantId) {
      throw new Error(
        "Tenant-scoped document created with no active tenant context. This is a bug, not a permissions gap.",
      );
    }

    this.tenantId = tenantId;
  });
}
