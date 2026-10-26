import type { Role } from "../common/enums";

/**
 * The permission matrix. Actions are grouped by the feature area they
 * belong to; several (org:billing:manage, members:invite, ...) don't have
 * a real endpoint yet — they're defined now so the matrix is the single
 * source of truth as Modules E/F/J wire up the endpoints that use them,
 * rather than each module inventing its own ad hoc role check.
 */
export const PERMISSIONS = [
  "org:delete",
  "org:billing:manage",
  "members:invite",
  "members:remove",
  "members:role:change",
  "projects:create",
  "projects:update",
  "projects:delete",
  "audit:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    "org:delete",
    "org:billing:manage",
    "members:invite",
    "members:remove",
    "members:role:change",
    "projects:create",
    "projects:update",
    "projects:delete",
    "audit:view",
  ],
  admin: [
    "members:invite",
    "members:remove",
    "projects:create",
    "projects:update",
    "projects:delete",
    "audit:view",
  ],
  member: ["projects:create", "projects:update"],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Permissions an admin impersonating a user must NOT be able to exercise,
 * regardless of the impersonated user's actual role — see
 * TenantContextGuard and ADR 0005. Deliberately a plain Set, not a DB-backed
 * config: "configurable" per the brief is satisfied by this being one
 * array to edit, not a UI to build in this pass.
 */
export const DESTRUCTIVE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "org:delete",
  "org:billing:manage",
  "members:remove",
  "members:role:change",
  "projects:delete",
]);
