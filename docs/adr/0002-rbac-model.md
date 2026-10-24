# ADR 0002: RBAC Model

## Status
Accepted

## Context

Three roles exist per org membership: `owner | admin | member`. Server-side
enforcement on every mutation is non-negotiable — the UI hiding a button is
cosmetic, not a security control, and this ADR is specifically about the
control that actually matters.

The obvious design is a second guard — `PermissionGuard`, reading the role
off `request.tenantContext.role` that `TenantContextGuard` already resolved
— run alongside `TenantContextGuard` via `@UseGuards(TenantContextGuard,
PermissionGuard)`. That design is wrong, and for the same reason described
in [ADR 0001](0001-tenant-isolation.md): NestJS runs every guard in one
`@UseGuards()` array in parallel via `Promise.all()`. A second guard reading
a field the first guard sets has no ordering guarantee — it is a race, not
a pipeline.

## Decision

Permission enforcement is a second responsibility of `TenantContextGuard`,
not a separate guard. `@RequirePermission(permission)` attaches metadata to
a route handler via `SetMetadata`; `TenantContextGuard` reads it with
`Reflector` *after* it has resolved the caller's membership and role, in
the same synchronous`canActivate()` call — no parallel branch, no race.

### The permission matrix (`rbac/permissions.ts`)

```
owner:  org:delete, org:billing:manage, members:invite, members:remove,
        members:role:change, projects:create, projects:update, projects:delete
admin:  members:invite, members:remove,
        projects:create, projects:update, projects:delete
member: projects:create, projects:update
```

Several of these (`org:billing:manage`, `members:invite`, `members:remove`,
`members:role:change`) don't have a real endpoint yet — they're defined now
so the matrix is the single source of truth as Modules E (invitations) and
F (billing) wire up the endpoints that will use them, rather than each
module inventing its own role check inline. The two that do have an
endpoint today (`projects:create`/`update`/`delete` on `ProjectsController`)
are enforced and tested.

### Why role lives only in the stored Membership

`TenantContextGuard` looks up the caller's `Membership` document by
`(userId, orgId)` on every request — it never trusts a role claimed by the
client (a header, a body field, a stale JWT claim). A JWT could be used to
cache the role for performance, but that reintroduces exactly the kind of
staleness bug this ADR exists to avoid (a user demoted mid-session keeps
acting on their old role until the token expires) — not worth it at this
scale, and the explicit proof test below is cheap insurance against
regressing it later.

## Proof

`rbac/rbac.integration.spec.ts`:

- A `member` can create and update a project but gets `403` attempting to
  delete one — and the project is confirmed still present afterward, not
  just a response-shape check.
- An `admin` *can* delete a project a different user (even the owner)
  created — permissions are per-role, not per-document-owner.
- A request that claims a different role via a header or body field
  (`X-Role: owner`, `{ role: "owner" }`) has no effect — the guard never
  reads role from the request, so there is nothing to spoof.

`rbac/permissions.spec.ts` unit-tests the matrix itself in isolation from
any HTTP/guard machinery.

## Consequences

- Any future tenant-scoped controller that needs permission checks must
  use `@RequirePermission()` alongside `TenantContextGuard` — introducing a
  separate guard for a new permission concern would silently reintroduce
  the Promise.all race this ADR avoids. That's a convention, not something
  the type system enforces; a reviewer checklist item.
- The matrix has no notion of resource ownership (e.g. "a member can edit
  their own project but not someone else's") — today every permission is
  role-wide within the org. If that's needed later, it has to be checked in
  the service/controller layer in addition to the role check, not instead
  of it.
