export type Role = "owner" | "admin" | "member";
export type Plan = "free" | "pro" | "business";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete";
export type UsageMetric = "api_calls" | "seats" | "projects" | "storage_mb";

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  isPlatformAdmin: boolean;
  impersonatorId?: string;
}

export interface MembershipOrg {
  _id: string;
  name: string;
  slug: string;
}

export interface MembershipSummary {
  orgId: MembershipOrg;
  role: Role;
}

export interface MeResponse {
  user: AuthUser;
  memberships: MembershipSummary[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface Project {
  _id: string;
  tenantId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemberUser {
  _id: string;
  name: string;
  email: string;
}

export interface Member {
  _id: string;
  userId: MemberUser;
  orgId: string;
  role: Role;
  status: string;
}

export interface Invitation {
  _id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface Subscription {
  _id: string;
  tenantId: string;
  plan: Plan;
  status: SubscriptionStatus;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

export interface UsageMetricRow {
  metric: UsageMetric;
  used: number;
  quota: number | null;
  remaining: number | null;
}

export interface UsageDashboard {
  plan: Plan;
  metrics: UsageMetricRow[];
}

export interface AuditLogEntry {
  _id: string;
  action: string;
  actorId: string;
  impersonatorId?: string | null;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}
