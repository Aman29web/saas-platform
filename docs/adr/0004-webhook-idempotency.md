# ADR 0004: Webhook Idempotency & Exactly-Once Effect

## Status
Accepted

## Context

Stripe does not guarantee exactly-once delivery or in-order delivery of
webhook events. It retries on timeout or a non-2xx response, and under
retry + concurrent-worker conditions the same event can arrive twice; two
related events (e.g. two updates to the same subscription) can arrive in
either order. A webhook handler that isn't explicitly built for this will
double-process a retried delivery or let a stale event overwrite newer
state.

## Decision

### Exactly-once effect: claim before process, not check-then-act

`WebhookEvent.stripeEventId` has a unique index. The handler **inserts a
record for the event before processing it**, not after, and not via a
separate "does this exist?" read followed by an insert. If the insert
succeeds, this is the first (and only) delivery that gets to process the
event's side effects. If it fails on the unique-index violation (Mongo
error code `11000`), this is a duplicate delivery — it's logged and the
request returns `200` with no further action.

A read-then-insert approach has a race: two concurrent deliveries of the
same event (plausible under Stripe's retry behavior combined with normal
network latency) could both pass the "does it exist?" check before either
has inserted, and both would process the event's side effects. Relying on
the unique index to fail one of two concurrent inserts is what actually
guarantees exactly one delivery processes the event, regardless of
timing.

### Out-of-order convergence: the event's own timestamp, not arrival order

Every webhook-sourced write to `Subscription` passes the Stripe event's
`created` timestamp to `SubscriptionsService.applyStripeChange()`, which
only applies the update if no previously-applied event is *newer*
(`lastReconciledEventAt` on the document, compared via `$lt` in the update
filter). An older event that arrives after a newer one — a delayed retry,
an out-of-order delivery from Stripe's side — matches no document (the
filter excludes it) and is silently discarded rather than overwriting the
newer, correct state.

This is why `applyStripeChange()` is the single choke point described in
[ADR 0003](0003-subscription-state-machine.md): action-initiated writes
(Module F) don't pass an event timestamp and always apply (there's no
ordering concern — the user just clicked something, right now, and wants
to see it reflected immediately); webhook-initiated writes always do, and
the two paths cannot diverge in how they decide what "the correct current
state" is, because there's only one code path making that decision.

### Signature verification before anything else

`POST /billing/webhook` has no auth guard — Stripe calls it with no
session, no JWT, nothing this app's normal auth stack understands.
Instead, `stripe.webhooks.constructEvent(rawBody, signature, secret)`
verifies the payload was actually signed by Stripe with the configured
webhook secret, using the **exact raw bytes** Stripe sent — Nest's
`rawBody: true` app option preserves `req.rawBody` alongside the normally
JSON-parsed `req.body`, because a signature computed over re-serialized
JSON does not match one computed over the original bytes (key order,
whitespace, and number formatting can all differ after a parse/stringify
round-trip). An invalid or missing signature is rejected with `400` before
the event is even looked at, let alone claimed or processed.

### Resolving which org an event belongs to

`customer.subscription.*` events carry `metadata.orgId` directly (set when
the subscription was created via Checkout in Module F). `invoice.*` events
don't carry it — only a `subscription` id — so they resolve the org via
`SubscriptionsService.findTenantIdByStripeSubscriptionId()`, a deliberate,
documented bypass of `tenantScopePlugin`'s query hooks via the native
MongoDB driver: there is no tenant context yet at this point (this is the
whole reason the lookup is needed), the same pattern used for Invitation
acceptance (Module E) and for the same reason — a short-lived, narrowly-
scoped read that happens before any tenant context can be established, not
the platform-admin escape hatch from ADR 0001.

An event that resolves to no org at all (a webhook for a subscription this
app has no record of — e.g. a test event from Stripe's dashboard, or a
subscription this app didn't create) is logged and acknowledged with `200`
rather than erroring; Stripe would otherwise retry it indefinitely for no
useful outcome.

### Disputes

`charge.dispute.created` is logged, not acted on — there's no automated
dispute-response workflow in this codebase yet. It's handled explicitly
(not falling through to the generic "unhandled event type" debug log) so
it's visible in production logs the moment it happens, since someone
needs to act on a dispute by hand regardless of what code exists.

## Proof

`billing/webhooks.service.spec.ts` (11 unit tests, mocked Stripe client and
models): signature rejection on a bad/missing secret, claim-then-process
ordering, duplicate-key handling, org resolution via metadata vs. fallback
lookup, and each event type's reconciliation target.

`billing/webhooks.integration.spec.ts` (6 tests) proves the exactly-once
and convergence properties end-to-end against a real `MongoMemoryReplSet`,
using Stripe's own `webhooks.generateTestHeaderString()` to produce a
genuinely valid signature (pure HMAC computation, no network call) so
signature verification is exercised for real, not mocked:

- An invalid signature is rejected before any processing.
- A correctly signed event reconciles the local `Subscription` record.
- The same event id delivered twice results in exactly one row in
  `webhook_events` and the side effect ran exactly once.
- **A newer event delivered before an older one**: the older event, on
  arrival, does not overwrite the newer state — proving convergence
  independent of delivery order, not just proving "the most recent HTTP
  request wins" (which out-of-order delivery specifically defeats).
- `invoice.payment_failed` → `past_due`, recovered by a later
  `invoice.paid` → `active`.
- An event for an unknown subscription is acknowledged, not retried
  forever.

## Consequences

- Every new webhook event type this app needs to handle must call
  `SubscriptionsService.applyStripeChange()` (or an equivalent future
  choke point for a different collection) with the event's `created`
  timestamp — hand-rolling a direct model update for a new event type
  would silently reintroduce the out-of-order bug this ADR exists to
  prevent.
- `WebhookEvent` grows forever (never pruned here) — at scale this needs a
  TTL index or an archival job; not implemented, since Module K's "100x
  scale" notes are the right place for it, not a correctness concern today.
