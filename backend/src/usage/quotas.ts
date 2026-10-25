import type { Plan, UsageMetric } from "../common/enums";

/** `null` means unlimited. Numbers below are illustrative, not pricing. */
export const QUOTAS: Record<Plan, Record<UsageMetric, number | null>> = {
  free: { projects: 3, seats: 3, api_calls: 5, storage_mb: 100 },
  pro: { projects: 50, seats: 20, api_calls: 50_000, storage_mb: 5_000 },
  business: { projects: null, seats: null, api_calls: 1_000_000, storage_mb: 50_000 },
};

export function quotaFor(plan: Plan, metric: UsageMetric): number | null {
  return QUOTAS[plan][metric];
}
