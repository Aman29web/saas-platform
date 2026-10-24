# ADR 0003: Subscription State Machine

## Status
Accepted (reconciliation from webhooks lands in Module G; this ADR covers
the state model and the action side built in Module F)

## Context

Every org has exactly one local `Subscription` document mirroring a Stripe
subscription (or the absence of one, for the free plan). Two different
code paths can change it:

1. **Action-initiated** (Module F, this ADR): the org's owner clicks
   "upgrade," "downgrade," or "cancel" in the app, which calls the Stripe
   API directly and then updates the local mirror optimistically so the UI
   reflects the change immediately.
2. **Event-initiated** (Module G, not yet built): Stripe calls our webhook
   when something changes on *their* side — a renewal succeeds, a card
   fails, a customer cancels from the Stripe-hosted portal instead of our
   app, a dispute opens.

## Decision

**Stripe is the source of truth, always.** The local `Subscription`
document is a read cache for "what plan/status is this org on right now,"
not an independent ledger. Action-initiated writes (Module F) update it
optimistically for immediate UI feedback; webhook-initiated writes
(Module G) are authoritative and always overwrite whatever the optimistic
update left behind, because they reflect what Stripe actually did, not
what we asked it to do. The two paths share one choke point —
`SubscriptionsService.applyStripeChange()` — precisely so Module G's
webhook handler calls the identical method Module F's actions call, rather
than maintaining two different "how do I update a subscription" code
paths that could drift.

### States

```
free ──checkout──► trialing/active
                       │
                       ├─ renewal succeeds ──► active (stays)
                       │
                       ├─ invoice.payment_failed ──► past_due
                       │                                │
                       │                    (dunning window, Module G)
                       │                                │
                       │                     payment recovered ──► active
                       │                     dunning exhausted  ──► canceled
                       │
                       ├─ change-plan (proration) ──► active (new price, same sub)
                       │
                       ├─ cancel(atPeriodEnd=true) ──► active, cancelAtPeriodEnd=true
                       │         │
                       │    period ends ──► canceled
                       │
                       └─ cancel(atPeriodEnd=false) ──► canceled (immediate)

canceled ──new checkout──► active (a new Stripe subscription, not a revival
                                     of the old one — Stripe subscriptions
                                     don't un-cancel)
```

`incomplete` exists in the status enum for the window between creating a
subscription and its first payment attempt resolving (relevant once
Checkout's `payment_behavior` or SCA-requiring cards are exercised) — no
code path in Module F produces it today; it's there so Module G's webhook
handler has a landing spot for Stripe's `incomplete`/`incomplete_expired`
statuses without a schema migration.

### Action-side decisions (Module F)

- **Upgrade and downgrade are the same operation** —
  `subscriptions.update()` with `proration_behavior: 'create_prorations'`
  on the existing subscription item. There's no separate "downgrade" code
  path with different proration rules; Stripe prorates the price
  difference either direction, same as what a customer sees in the
  Stripe-hosted portal.
- **`free` has no Stripe price and isn't a Stripe subscription at all** —
  `priceIdForPlan('free', ...)` throws rather than returning anything,
  and both checkout and change-plan reject it explicitly. Moving to free
  means canceling the Stripe subscription, not "subscribing to a $0 plan."
- **Cancellation is a parameter, not two endpoints**: `cancel(atPeriodEnd)`.
  `atPeriodEnd: true` calls `subscriptions.update({ cancel_at_period_end:
  true })` — the org keeps access until the current period ends, matching
  what most SaaS products do by default. `atPeriodEnd: false` calls
  `subscriptions.cancel()` for an immediate stop, with the local mirror
  dropped straight to `plan: 'free', status: 'canceled'`.
- **Stripe customers are created lazily**, on first checkout or portal
  access, not eagerly at signup — `ensureStripeCustomer()` checks
  `org.stripeCustomerId` first and only calls `customers.create()` if
  missing. An org that never touches billing never gets a Stripe customer
  object at all.

### Billing access

`org:billing:manage` is owner-only in the [RBAC matrix](0002-rbac-model.md)
— an admin can run the team day-to-day but cannot touch the org's payment
method or plan. Enforced the same way every other permission is: via
`TenantContextGuard`, not a separate guard (see ADR 0001/0002 for why a
second guard here would race it).

## What Module G still owns

- The actual webhook endpoint, signature verification, and idempotent
  event processing (`WebhookEvent` dedup by `stripeEventId`).
- Reconciling `past_due` → dunning-grace-period → `canceled`, and the
  reverse when a failed payment is recovered.
- Handling out-of-order webhook delivery (an `invoice.paid` arriving after
  a later `customer.subscription.updated` for the same subscription) —
  this ADR's "webhook always wins" rule needs a tiebreaker when two
  webhook events disagree with each other, not just when a webhook
  disagrees with our own optimistic write.

## Consequences

- Every new write to `Subscription` — from anywhere — must go through
  `SubscriptionsService.applyStripeChange()`, not a direct model update,
  or Module G's "webhook always wins" invariant has a second code path to
  stay consistent with.
- Money is handled entirely in minor units and plan names by the
  application; nothing here parses or stores a currency amount. Stripe
  owns amounts; we own "which plan."
