# ADR 0001: Tenant Isolation Strategy

## Status
Accepted

## Context

MongoDB has no row-level security and no native concept of "tenant." Every
tenant-owned document lives in the same cluster, and nothing stops a buggy
query from reading or writing another tenant's data unless the application
enforces that boundary itself. For a B2B SaaS platform this is the single
highest-consequence correctness property in the system — a leak here is a
breach, not a bug ticket.

Three options were considered:

1. **Shared collections + `tenantId` on every document.** One database, one
   set of collections; every tenant-owned document carries an indexed
   `tenantId`. Isolation is enforced in the application layer.
2. **Database-per-tenant.** Strongest physical isolation. Rejected: every
   schema migration becomes N migrations, cross-tenant analytics and the
   platform-admin views in Module J require fanning out across N
   connections, and connection-pool/Atlas-tier costs scale linearly with
   tenant count rather than with load.
3. **Collection-per-tenant.** Rejected outright: it has none of
   database-per-tenant's isolation benefit (still one database, one set of
   credentials) while inheriting all of its operational cost (schema drift
   per tenant, no simple global index, migrations that fan out per tenant).
   There is no scenario where this beats option 1 or option 2.

## Decision

**Option 1: shared collections with an enforced `tenantId`.** "Enforced"
is the operative word — convention-based scoping (every service method
remembers to add `{ tenantId }` to its filters) was explicitly rejected as
the primary mechanism, because it fails exactly when you need it not to:
under time pressure, in a new contributor's first PR, in the one query
added six months from now that nobody thinks to re-review against this ADR.

The isolation layer has four parts:

### 1. Request-scoped tenant context (`tenancy/tenant-context.ts`)

An `AsyncLocalStorage<TenantContextData>` holding `{ tenantId, userId, role }`
for the lifetime of a request. Resolved once per request by
`TenantContextGuard` from the authenticated user's membership in the org
named by the `X-Org-Id` header (this is the org-switcher: a user with
multiple memberships picks one, and every subsequent request names it
explicitly rather than relying on "last selected" server-side state).

### 2. A guard + an interceptor, not one guard

The natural design — one guard that both authenticates and calls
`AsyncLocalStorage.enterWith()` — does not work with NestJS's pipeline.
Two things broke it, in order, both worth recording because they're
non-obvious and will bite anyone who "simplifies" this later:

- **NestJS runs every guard in a `@UseGuards(...)` array via
  `Promise.all()`.** Each guard's `canActivate()` executes in its own
  parallel branch. `enterWith()` only affects the calling continuation, so
  a tenant context entered inside one of several parallel branches is gone
  by the time `Promise.all` resolves and control returns to the (unrelated)
  continuation that invokes the controller.
- Even with a **single** guard, Nest bridges the resolved guard result into
  the handler invocation through an RxJS `Observable` subscription — a new
  continuation, not a direct continuation of the guard's own promise chain.
  `enterWith()` does not survive that boundary either.

The fix: `TenantContextGuard` only *validates* (auth, membership, 400/401/403
as appropriate) and attaches the resolved `{ tenantId, userId, role }` to
`request.tenantContext` — a plain object mutation, visible everywhere
regardless of which continuation touches it. `TenantContextInterceptor`
then wraps the actual handler invocation in `AsyncLocalStorage.run()`,
which explicitly brackets the scope around a callback rather than relying
on implicit continuation — the correct tool for spanning an RxJS scheduling
boundary. Every tenant-scoped controller needs both:
`@UseGuards(TenantContextGuard)` and `@UseInterceptors(TenantContextInterceptor)`.

### 3. A Mongoose plugin, not a base service class (`tenancy/tenant-scope.plugin.ts`)

Applied directly to a schema (`ProjectSchema.plugin(tenantScopePlugin)`),
it hooks every read/update/delete query (`find`, `findOne`,
`findOneAndUpdate`, `updateMany`, `deleteMany`, `countDocuments`, `aggregate`,
…) to inject `{ tenantId }` from the active `TenantContext`, and hooks
`pre('validate')` — not `pre('save')` — to stamp new documents with it.

`pre('validate')` matters: Mongoose runs schema validation (including
`required: true` on `tenantId`) *before* `pre('save')` fires, so a hook that
tries to backfill a required field in `pre('save')` always loses to "field
is required" — the document is rejected before the hook that would have
fixed it ever runs. This was caught by the integration test, not reasoned
out in advance; it's the kind of mistake the proof test below exists to
catch.

If neither an active tenant context nor an explicit bypass (below) is
present, every hook **throws** rather than running unscoped. A forgotten
`@UseGuards`/`@UseInterceptors` pair fails loudly and immediately in
development, not silently in production three months later.

A known limitation: the plugin does not currently hook `insertMany()` (not
used anywhere in the codebase yet). If a future module needs it, it must be
added to the plugin's hook list — `Model.insertMany()` does not route
through `save()`/`validate()` document middleware the way `create()` does.

### 4. An explicit, logged escape hatch (`tenancy/tenant-bypass.ts`)

Platform admin/support tooling legitimately needs cross-tenant reads (e.g.
Module J's impersonation, or a "show me every project across every org"
support view). `runAsTenantBypass({ actorId, reason }, fn)` logs the actor
and reason *before* running `fn`, then runs it inside a second
`AsyncLocalStorage` that the plugin's hooks check and skip scoping for.

This is deliberately not a query-level flag (`.setOptions({ skipTenantScope: true })`)
that a developer could sprinkle onto an unrelated query by mistake — it's a
function you wrap an entire operation in, gated upstream by
`PlatformAdminGuard`, and it cannot create a document without an explicit
`tenantId` (the plugin throws if you try) — the bypass is for cross-tenant
*reads*, not an accidental way to write an orphaned document. Full
persisted audit trail entries for bypass usage land in Module I; today this
is a structured `Logger.warn()` call, which already satisfies "explicit and
logged" for this module but is not yet queryable the way Module I's
`AuditLog` will be.

### Indexes

Every tenant-scoped collection leads its compound indexes with `tenantId`
(e.g. `{ tenantId: 1, createdAt: -1 }` on `Project`), so the auto-injected
`tenantId` filter also drives efficient index usage rather than requiring a
separate index strategy.

## Proof

`tenancy/tenant-isolation.integration.spec.ts` exercises, against a real
`MongoMemoryReplSet`:

- Tenant A cannot read, update, or delete tenant B's project through the
  API even when it has the real document id.
- Tenant A's project list never includes tenant B's documents.
- A request naming an org the caller isn't a member of is rejected (403),
  and a request with no `X-Org-Id` header at all is rejected (400) —
  neither silently defaults to "no scoping."
- Calling the raw Mongoose model directly — simulating a developer who
  forgot to go through the service layer — still cannot cross tenants, and
  with no tenant context and no bypass active, it throws instead of running
  unscoped.
- The admin escape hatch is gated to platform admins and does, correctly,
  see both tenants' data when used.

## Consequences

- Every new tenant-owned Mongoose schema must call
  `schema.plugin(tenantScopePlugin)`, and every new tenant-scoped
  controller must apply both `TenantContextGuard` and
  `TenantContextInterceptor` — not just the guard. This is a convention the
  plugin cannot auto-enforce at the schema-registration level; a reviewer
  checklist item, not a compiler guarantee.
- `insertMany()` is unsupported by the plugin today; adding it anywhere
  tenant-scoped requires extending the plugin first.
- At significant scale, a single shared database means every tenant
  competes for the same connection pool and the same indexes grow with
  total platform data, not per-tenant data. See the "100x scale" note in
  the README for the sharding-by-`tenantId` mitigation.
