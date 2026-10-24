export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const PLANS = ["free", "pro", "business"] as const;
export type Plan = (typeof PLANS)[number];

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ["active", "removed"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const USAGE_METRICS = ["api_calls", "seats", "projects", "storage_mb"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];
