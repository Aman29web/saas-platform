# Multi-Tenant SaaS Platform

A production-grade multi-tenant B2B SaaS platform: organizations with teams
and role-based access, per-tenant data isolation on MongoDB, Stripe
subscription billing, usage metering with quota enforcement, email-based
invitations, an append-only audit log, and admin impersonation.

**Build status: Modules A–K complete.**

## Stack

- **Frontend**: React 18 + TypeScript + Vite, Tailwind CSS, TanStack Query, React Router, React Hook Form + Zod
- **Backend**: NestJS + TypeScript, MongoDB Atlas + Mongoose, Stripe, Resend, BullMQ + Redis, JWT
- **Infra**: docker-compose, GitHub Actions CI, Stripe CLI (local webhook forwarding)

## Repository layout

`backend/` and `frontend/` are **fully independent projects** — separate
`package.json`, separate lockfile, separate install/build/test/lint. There is
no shared workspace or shared package between them; the small amount of
overlap (role/plan enums, auth DTOs) is intentionally duplicated in each
project rather than imported from a common package, so either one could be
extracted to its own repository with no further untangling.

```
backend/    NestJS API (own package.json, own tests, own Dockerfile)
frontend/   React app (own package.json, own tests, own Dockerfile)
docs/
  adr/      Architecture decision records
```

## Architecture

```
                         ┌─────────────────────┐
                         │   React frontend     │
                         │  (Vite, TanStack Q)  │
                         └──────────┬───────────┘
                                    │ HTTPS, httpOnly cookies
                                    ▼
                         ┌─────────────────────────────────────────┐
                         │               NestJS API                 │
                         │                                           │
  Request ──► AuthGuard /│ TenantContextGuard  ──►  Interceptor     │
  (JWT cookie)│          │ (auth + membership +     (AsyncLocalStorage│
              │          │  permission check,        scope for the   │
              │          │  one guard, see ADR 1/2)  handler's call  │
              │          └──────────────┬────────────┬───tree)       │
              │                         │            │               │
              │                 ┌───────▼───┐  ┌──────▼───────┐      │
              │                 │  Services  │  │ Mongoose     │      │
              │                 │ (business  │──│ tenantScope  │      │
              │                 │  logic)    │  │ plugin: every│      │
              │                 └───────┬────┘  │ query/write  │      │
              │                         │        │ auto-filtered│     │
              │                         │        │ by tenantId  │     │
              │                         │        └──────┬───────┘     │
              │                         │               │             │
              │              ┌──────────┼───────────────▼──────┐      │
              │              │                                 │      │
              │        ┌─────▼─────┐                    ┌──────▼────┐ │
              │        │  MongoDB   │                    │   BullMQ   │ │
              │        │  (Atlas)   │                    │ + Redis    │ │
              │        └────────────┘                    └─────┬─────┘ │
              │                                                 │       │
              │                                     ┌───────────▼────┐  │
              │                                     │ invite emails,  │  │
              │                                     │ usage rollups   │  │
              │                                     └────────────────┘  │
              │                                                           │
              │         ┌───────────────────────────────────────┐        │
              └────────►│  Stripe (checkout, portal, webhooks)   │◄───────┘
                        └───────────────────────────────────────┘
```

Every tenant-scoped request flows through exactly one guard
(`TenantContextGuard`) that authenticates, resolves the caller's
org membership, and enforces the required permission in one pass — then
one interceptor (`TenantContextInterceptor`) that scopes an
`AsyncLocalStorage` context around the handler's entire execution, which
`tenantScopePlugin` reads on every Mongoose query and write. See
[ADR 0001](docs/adr/0001-tenant-isolation.md) for why this is split across
a guard and an interceptor rather than combined into one guard, or two
guards — both of the obvious alternatives are silently broken by how
NestJS actually schedules guards and handlers.

## Data model

| Collection | Tenant-scoped? | Notes |
|---|---|---|
| `users` | No | Global identity; `isPlatformAdmin` gates Module J |
| `organizations` | — (is the tenant) | `stripeCustomerId` created lazily on first checkout |
| `memberships` | No (filtered by `orgId` explicitly) | `(userId, orgId)` → `role`; a user can belong to many orgs |
| `invitations` | Yes | Token stored as a SHA-256 hash, never the raw token |
| `subscriptions` | Yes | Mirrors Stripe; Stripe is the source of truth ([ADR 0003](docs/adr/0003-subscription-state-machine.md)) |
| `webhook_events` | No (dedup happens before any tenant is known) | Unique `stripeEventId`; claimed before processing |
| `usage_records` | Yes | Append-only; idempotent via a unique `(tenantId, idempotencyKey)` partial index |
| `usage_rollups` | Yes | Pre-aggregated cache of `usage_records`, written by the hourly BullMQ job |
| `audit_logs` | Yes | Append-only; actor/impersonator/ip pulled from the ambient tenant context, never from the caller |
| `projects` | Yes | The sample tenant resource proving isolation + quotas in practice |

`memberships` is deliberately **not** run through `tenantScopePlugin`: a
membership is looked up by `(userId, orgId)` from both directions (a
user's org list, an org's member list), and scoping it to "the current
tenant" would make the former impossible. Every query against it filters
by `orgId` explicitly instead.

## Module-by-module summary

| # | Module | What it is |
|---|---|---|
| A | Scaffold | pnpm workspace → split into independent `backend`/`frontend`; Zod-validated env; CI |
| B | Auth & Sessions | argon2, JWT access + rotating refresh tokens, atomic signup transaction |
| C | **Tenant isolation** | The enforced Mongoose plugin + guard/interceptor split — see [ADR 0001](docs/adr/0001-tenant-isolation.md) |
| D | RBAC | Permission matrix enforced in the same guard, not a second one — [ADR 0002](docs/adr/0002-rbac-model.md) |
| E | Invitations | Token-based, single-use, email via BullMQ + Resend (degrades to a log line with no API key) |
| F | Stripe billing | Checkout, portal, proration, cancel — [ADR 0003](docs/adr/0003-subscription-state-machine.md) |
| G | Webhooks | Claim-before-process idempotency, out-of-order convergence — [ADR 0004](docs/adr/0004-webhook-idempotency.md) |
| H | Usage & quotas | Live counts for projects/seats, genuine event metering for `api_calls` |
| I | Audit log | Append-only, actor/impersonator/ip from ambient context automatically |
| J | Impersonation | Org-scoped (not just user-scoped) so every existing guard resolves it unmodified — [ADR 0005](docs/adr/0005-impersonation-scope.md) |
| K | Polish | Rate limiting, global exception filter, Dockerfiles, this README |

## Local development

### Prerequisites
- Node 20+, pnpm 9+
- A MongoDB Atlas connection string (or any reachable Mongo instance) — set as `MONGO_URI`
- Redis (via `docker-compose up redis`, or any local Redis) — required for the BullMQ invite-email and usage-rollup queues
- A Resend API key (optional in dev — with none set, invite emails are logged and skipped instead of sent)
- A Stripe test-mode secret key + two recurring prices (`STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`) to exercise checkout/portal/change-plan/cancel against real Stripe
- Stripe CLI (`stripe listen --forward-to localhost:4000/api/billing/webhook`) to forward real webhook events — set the forwarding secret it prints as `STRIPE_WEBHOOK_SECRET`

### Setup

```bash
# backend
cd backend
pnpm install
cp .env.example .env   # fill in MONGO_URI, JWT secrets, etc.
pnpm dev                # http://localhost:4000/api/health

# frontend (separate terminal)
cd frontend
pnpm install
cp .env.example .env
pnpm dev                # http://localhost:5173
```

```bash
# Redis, from the repo root
docker-compose up -d redis
```

Or the whole stack via Docker:

```bash
docker-compose up --build
```

### Env validation

The backend validates its environment with Zod at boot (`backend/src/config/env.schema.ts`).
Missing or malformed variables cause an immediate, descriptive startup failure
rather than a runtime surprise later.

### Scripts (run from inside `backend/` or `frontend/`)

- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build`

### Testing notes

Every integration suite spins up its own `MongoMemoryReplSet` (transactions
need a replica set) and, where a suite touches BullMQ or Stripe, swaps the
real module for a fake one via `overrideModule()`/`overrideProvider()`
rather than requiring a live Redis connection or Stripe account to run.
`jest.config.js` caps `maxWorkers` at 4 — running every suite's own replica
set fully parallel across all CPU cores can exhaust memory on smaller
machines.

## Architecture decisions

See [`docs/adr/`](docs/adr/) for the full write-ups, including the
non-obvious NestJS pitfalls (guards running in parallel via `Promise.all`,
a guard's result crossing into the handler through a new RxJS
continuation) that shaped several of these:

- [0001 — Tenant isolation strategy](docs/adr/0001-tenant-isolation.md)
- [0002 — RBAC model](docs/adr/0002-rbac-model.md)
- [0003 — Subscription state machine](docs/adr/0003-subscription-state-machine.md)
- [0004 — Webhook idempotency](docs/adr/0004-webhook-idempotency.md)
- [0005 — Impersonation scope](docs/adr/0005-impersonation-scope.md)

## Trade-offs worth defending

- **Shared database, enforced `tenantId`** over database-per-tenant: cheaper
  to run and migrate at this scale, at the cost of noisier-neighbor risk
  under heavy load from one tenant — see "100x scale" below.
- **Backend and frontend are two separate projects**, not a monorepo with a
  shared types package, per explicit instruction mid-build — the small
  duplication (role/plan enums, a couple of DTOs) is a one-time cost, paid
  once, in exchange for either project being extractable to its own repo
  with zero untangling.
- **Permission/tenant checks live inside one guard**, not a clean
  guard-per-concern design, because NestJS's actual request-pipeline
  semantics (parallel guard execution, guard→handler via a new RxJS
  continuation) make the "obvious" decomposition silently wrong. Documented
  heavily in code comments and ADR 0001/0002 specifically so a future
  "cleanup" doesn't reintroduce the bug.
- **Usage quotas use two different enforcement shapes** (live count vs.
  event log) rather than forcing every metric through one model, because
  projects/seats and `api_calls` are genuinely different kinds of
  quantities — one is "how many exist right now," the other is "how many
  things happened this period."
- **No frontend UI was built out beyond the scaffold + error/toast
  infrastructure.** This build prioritized the backend's correctness
  surface (isolation, RBAC, billing, webhooks, quotas, audit, impersonation)
  and its test coverage over a full React UI for every module — a
  deliberate scope call given the brief's module sequencing, not an
  oversight.

## What I'd do at 100x scale

- **Shard MongoDB by `tenantId`.** The isolation layer already gives every
  tenant-owned query a leading `tenantId` in its filter and indexes — that's
  exactly the shard key Mongo wants. The large-tenant/small-tenant skew
  (a few huge orgs, many tiny ones) would need shard-zone tuning, not a
  schema change.
- **Read replicas for the usage/audit dashboards.** Both are read-heavy,
  tolerate slightly stale data, and currently hit the primary like
  everything else.
- **Move metering off the request hot path.** `QuotaService` currently
  reads the quota and records the event inline, in the same request that's
  being metered. At high volume, this becomes "enqueue a usage event,
  enforce the quota from a fast in-memory/Redis counter kept in sync by a
  consumer" instead of a synchronous Mongo round-trip per request.
- **Per-tenant rate limits**, not just per-IP. The current `@Throttle()`
  limits are per-IP, which is right for unauthenticated endpoints
  (login/signup) but wrong for authenticated ones — right now one
  thundering-herd tenant could be rate-limited into frustration by another
  tenant's traffic sharing a NAT'd IP, or conversely a single bad actor
  inside a huge tenant could be invisible against that tenant's IP-level
  budget. `TenantContext.tenantId` is already available at the point the
  guard runs — a tenant-keyed throttle storage is the natural next step.
- **Move the webhook claim-and-process out of the request/response cycle.**
  Right now `WebhooksController` processes the event inline before
  returning 200; at scale, it should enqueue and return immediately, with
  BullMQ retrying the actual Stripe-event processing — the idempotency
  design (claim via unique index, convergence via event timestamp) already
  supports being called from a worker instead of a controller unchanged.
- **Push `AuditLog` and `WebhookEvent` to a TTL'd or archived store.** Both
  grow forever today (correctly — they're append-only by design) but
  neither needs to live in the hot primary past a retention window.

## Deploying

1. **MongoDB Atlas**: create a cluster, a database user, and allow the
   deploy host's IP (or `0.0.0.0/0` for simplicity on a managed platform
   with no fixed egress IP). Copy the connection string into `MONGO_URI`.
2. **Redis**: a managed instance (Railway, Upstash, Fly's managed Redis) —
   anything reachable at a `redis://` URL works for `REDIS_URL`.
3. **Stripe**: create the Pro/Business prices in test mode first, copy their
   ids into `STRIPE_PRICE_PRO`/`STRIPE_PRICE_BUSINESS`, and set up a webhook
   endpoint pointing at `https://<your-api-host>/api/billing/webhook` for
   the real (non-CLI) `STRIPE_WEBHOOK_SECRET`.
4. **Backend** (`backend/Dockerfile`): deploy to Fly.io or Railway as a
   standard Node container. Set every variable in `backend/.env.example`
   as a real secret on the platform — never commit `.env`.
5. **Frontend** (`frontend/Dockerfile`, nginx-served static build): deploy
   as a separate service/static site, with `VITE_API_URL` pointing at the
   backend's public URL. `docker-compose.yml` demonstrates both together
   for local verification before deploying either independently.
6. Point the backend's `WEB_APP_URL` at the deployed frontend's URL (used
   for CORS and for the links in invite emails and Stripe checkout/portal
   redirects).

## Tenant isolation (summary)

Single shared database; every tenant-owned document carries an indexed
`tenantId`. Isolation is enforced by a Mongoose plugin that injects the
request-scoped tenant into every query and write — not by convention in
service code, and it fails closed (throws) rather than running unscoped if
the context is missing. A platform-admin escape hatch exists for legitimate
cross-tenant reads, gated to platform admins and logged before it runs.
Full rationale, the two non-obvious NestJS pitfalls that shaped the
guard/interceptor split, and the cross-tenant proof test are in
[ADR 0001](docs/adr/0001-tenant-isolation.md).
