import { SetMetadata } from "@nestjs/common";
import type { Permission } from "./permissions";

export const PERMISSION_KEY = "requiredPermission";

/**
 * Marks a route as requiring a permission. Enforced by TenantContextGuard
 * (not a separate guard — see tenant-context.guard.ts for why: NestJS runs
 * every guard in a @UseGuards() array in parallel, so a second guard reading
 * `request.tenantContext` set by the first would race it).
 */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
