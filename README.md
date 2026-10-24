# Multi-Tenant SaaS Platform

A production-grade multi-tenant B2B SaaS platform: organizations with teams
and role-based access, per-tenant data isolation on MongoDB, Stripe
subscription billing, usage metering with quota enforcement, email-based
invitations, an audit log, and admin impersonation.

Build status: **Module A — scaffold & config** complete.

## Stack

- **Frontend**: React 18 + TypeScript + Vite, Tailwind CSS, TanStack Query, React Router, React Hook Form + Zod
- **Backend**: NestJS + TypeScript, MongoDB Atlas + Mongoose, Stripe, Resend, BullMQ + Redis, JWT
- **Infra**: pnpm workspaces monorepo, docker-compose, GitHub Actions CI, Stripe CLI (local webhook forwarding)

## Monorepo layout

```
apps/
  api/      NestJS backend
  web/      React frontend
packages/
  shared/   Shared Zod schemas, types, env validation
docs/
  adr/      Architecture decision records
```

## Local development

### Prerequisites
- Node 20+, pnpm 9+
- A MongoDB Atlas connection string (or any reachable Mongo instance) — set as `MONGO_URI`
- Redis (via `docker-compose up redis`, or any local Redis)
- Stripe CLI (`stripe listen --forward-to localhost:4000/api/billing/webhook`) — from Module F onward

### Setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # fill in MONGO_URI, JWT secrets, etc.
cp apps/web/.env.example apps/web/.env
docker-compose up -d redis
pnpm dev:api     # http://localhost:4000/api/health
pnpm dev:web     # http://localhost:5173
```

### Env validation

Both apps validate their environment with Zod at boot (`packages/shared/src/env.ts`).
Missing or malformed variables cause an immediate, descriptive startup failure
rather than a runtime surprise later.

### Scripts

- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` — run across all workspace packages
- `pnpm seed` — (added in Module C) seeds sample tenants/users

## Architecture decisions

See [`docs/adr/`](docs/adr/) for recorded trade-offs. Written as the relevant
module lands:

- Tenant isolation strategy (Module C)
- Webhook idempotency (Module G)
- Subscription state machine (Module F)
- RBAC model (Module D)

## Tenant isolation (summary)

Single shared database; every tenant-owned document carries an indexed
`tenantId`. Isolation is enforced by a Mongoose plugin that injects the
request-scoped tenant into every query and write — not by convention in
service code. Full rationale and the cross-tenant-access proof test land in
Module C.
