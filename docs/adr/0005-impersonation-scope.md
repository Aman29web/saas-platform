# ADR 0005: Admin Impersonation Is Org-Scoped, Not Just User-Scoped

## Status
Accepted

## Context

"Log in as this user" for platform support needs to answer a specific
question — "what does this user see in this org" — not just "let me act as
this user everywhere." A user can belong to many orgs; impersonating them
without picking one leaves every downstream guard with nothing to resolve
a role against, since role is per-membership, not per-user.

## Decision

**`POST /admin/impersonate/:userId/:orgId`** — impersonation targets a
specific `(user, org)` pair, not just a user. This is not just a narrower
scope for safety's sake (though it is that too); it's what makes the whole
feature reuse every existing mechanism unmodified instead of needing a
parallel one:

- The impersonation access token's `sub` claim is the **target user's own
  id**, with an added `impersonatorId` claim. `AuthGuard` and
  `TenantContextGuard` don't need impersonation-specific branches — they
  resolve the token exactly as they would for the user acting themselves,
  which means `TenantContextGuard` looks up the target's **real**
  membership in the chosen org and gets their **real** role. There is no
  second role-resolution path to keep in sync with [ADR 0002](0002-rbac-model.md)'s.
- `TenantContext` already carried an `impersonatorId` field from Module C
  onward (originally there for exactly this), so every audit-logged action
  taken during the session automatically records who was really behind it
  — see [the audit log](../../backend/src/audit-log/audit-log.service.ts) —
  with zero special-casing in `AuditLogService.record()`.

### Destructive actions are blocked, independent of role

`DESTRUCTIVE_PERMISSIONS` (`org:delete`, `org:billing:manage`,
`members:remove`, `members:role:change`, `projects:delete`) are refused
whenever `impersonatorId` is set on the request, in the same
`TenantContextGuard` permission check that already resolves the
`@RequirePermission()` decorator — not a separate guard, for the identical
Promise.all reason given in ADR 0001/0002. This holds **even if the
impersonated user is the org's owner**, who would normally be allowed
every one of those actions: a support session investigating a billing
issue should never be the thing that actually deletes the org.

The list is a plain `Set`, not a database-backed policy — "configurable"
per the brief's wording is satisfied by it being one array to edit, not a
UI or schema to build in this pass.

### Session mechanics: stash-and-restore, not a parallel session

Starting impersonation swaps the `access_token` cookie for the
impersonation token and stashes the admin's own current access token in a
separate `admin_access_token` cookie. No refresh token is issued for the
impersonation session — it is bounded by its own short expiry (15
minutes) and cannot be silently extended. `POST /admin/impersonate/exit`
restores the stashed admin token and clears the stash.

The exit endpoint is deliberately **not** gated by `AuthGuard` +
`PlatformAdminGuard`: during impersonation the *active* session
authenticates as the target user, not the admin, so a guard checking "is
the current session a platform admin" would reject the admin's own
request to stop impersonating. Admin identity is instead verified by
successfully decoding the stashed `admin_access_token` cookie — a validly
signed JWT with no `impersonatorId` claim of its own, which only the
server could have produced during a real `startImpersonation` call. This
lives on its own `ImpersonationExitController`, not `AdminController`, so
the difference in gating is visible at a glance rather than buried in a
per-method guard override.

## Proof

`admin/impersonation.integration.spec.ts`:

- A non-admin cannot start impersonation (403).
- Impersonating a target user resolves their real membership/role in the
  chosen org, and every subsequent action is correctly audited with the
  impersonated user as actor and the admin as `impersonatorId`.
- A destructive action is blocked during impersonation even though the
  impersonated user is the org's owner; a non-destructive action in the
  same session still succeeds.
- Exiting restores the admin's own session, which can then use
  platform-admin-only endpoints again; the stash cookie is cleared.
- Exiting with no stashed session is rejected (401) — there's nothing to
  prove admin identity from.
- Impersonating a user who isn't actually a member of the named org is
  rejected (404) before any token is issued.

## Consequences

- Impersonation cannot target "this user, in whichever org they're
  currently using" without the admin knowing which org that is — a minor
  UX cost (the admin-facing UI needs to let them pick the org) in exchange
  for reusing the entire tenant-resolution stack instead of forking it.
- `DESTRUCTIVE_PERMISSIONS` has to be kept in sync by hand as new
  permissions are added to the matrix in ADR 0002 — there's no type-level
  link forcing every new destructive permission to be added to both lists.
