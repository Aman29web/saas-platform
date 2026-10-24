# Multi-Tenant SaaS Platform

A production-grade multi-tenant B2B SaaS platform: organizations with teams
and role-based access, per-tenant data isolation on MongoDB, Stripe
subscription billing, usage metering with quota enforcement, email-based
invitations, an audit log, and admin impersonation.

Build status: **Modules A–F complete** (scaffold, auth/sessions, tenant
isolation, RBAC, invitations & email, Stripe billing). Module G (webhook
idempotency) next.

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
frontend/   React app (own package.json, own tests)
docs/
  adr/      Architecture decision records
```

## Local development

### Prerequisites
- Node 20+, pnpm 9+
- A MongoDB Atlas connection string (or any reachable Mongo instance) — set as `MONGO_URI`
- Redis (via `docker-compose up redis`, or any local Redis) — required from Module E onward for the BullMQ invite-email queue
- A Resend API key (optional in dev — with none set, invite emails are logged and skipped instead of sent)
- A Stripe test-mode secret key + two recurring prices (`STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`) to exercise checkout/portal/change-plan/cancel against real Stripe
- Stripe CLI (`stripe listen --forward-to localhost:4000/api/billing/webhook`) — from Module G onward, once the webhook endpoint exists

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

### Env validation

The backend validates its environment with Zod at boot (`backend/src/config/env.schema.ts`).
Missing or malformed variables cause an immediate, descriptive startup failure
rather than a runtime surprise later.

### Scripts (run from inside `backend/` or `frontend/`)

- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build`
- `pnpm seed` (backend, added in Module C) — seeds sample tenants/users

## Architecture decisions

See [`docs/adr/`](docs/adr/) for recorded trade-offs. Written as the relevant
module lands:

- [Tenant isolation strategy](docs/adr/0001-tenant-isolation.md) (Module C) ✅
- [RBAC model](docs/adr/0002-rbac-model.md) (Module D) ✅
- [Subscription state machine](docs/adr/0003-subscription-state-machine.md) (Module F) ✅
- Webhook idempotency (Module G)

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
