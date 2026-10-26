import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/auth/AuthContext";
import type { Plan, Subscription } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";

const PLAN_LABELS: Record<Plan, string> = { free: "Free", pro: "Pro", business: "Business" };

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "destructive"> = {
  active: "success",
  trialing: "success",
  past_due: "warning",
  canceled: "destructive",
  incomplete: "warning",
};

export function BillingPage() {
  const { activeOrgId, activeRole } = useAuth();
  const queryClient = useQueryClient();
  const canManage = activeRole === "owner";

  const { data: subscription, isLoading, error } = useQuery({
    queryKey: ["subscription", activeOrgId],
    queryFn: async () => (await apiClient.get<Subscription>("/api/billing/subscription")).data,
    enabled: Boolean(activeOrgId) && canManage,
    retry: false,
  });

  const checkoutMutation = useMutation({
    mutationFn: (plan: "pro" | "business") =>
      apiClient.post<{ url?: string }>("/api/billing/checkout", { plan }),
    onSuccess: (res) => {
      if (res.data.url) window.location.href = res.data.url;
    },
  });

  const portalMutation = useMutation({
    mutationFn: () => apiClient.post<{ url?: string }>("/api/billing/portal"),
    onSuccess: (res) => {
      if (res.data.url) window.location.href = res.data.url;
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: (plan: "pro" | "business") => apiClient.post("/api/billing/change-plan", { plan }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscription", activeOrgId] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (atPeriodEnd: boolean) => apiClient.post("/api/billing/cancel", { atPeriodEnd }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscription", activeOrgId] }),
  });

  if (!activeOrgId) return <p className="text-sm text-slate-500">No active organization.</p>;
  if (!canManage) {
    return <p className="text-sm text-slate-500">Only the organization owner can manage billing.</p>;
  }
  if (isLoading) return <PageSpinner />;
  if (error || !subscription) {
    return <p className="text-sm text-red-600">Could not load billing information.</p>;
  }

  const hasStripeSubscription = Boolean(subscription.stripeSubscriptionId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Billing</h1>
        <p className="text-sm text-slate-500">Manage your plan and payment method.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold text-slate-900">{PLAN_LABELS[subscription.plan]}</span>
              <Badge variant={STATUS_VARIANT[subscription.status] ?? "default"} className="capitalize">
                {subscription.status.replace("_", " ")}
              </Badge>
              {subscription.cancelAtPeriodEnd && <Badge variant="warning">Cancels at period end</Badge>}
            </div>
            {subscription.currentPeriodEnd && (
              <p className="text-sm text-slate-500">
                Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!hasStripeSubscription && subscription.plan !== "pro" && (
                <Button loading={checkoutMutation.isPending} onClick={() => checkoutMutation.mutate("pro")}>
                  Upgrade to Pro
                </Button>
              )}
              {!hasStripeSubscription && (
                <Button
                  variant="outline"
                  loading={checkoutMutation.isPending}
                  onClick={() => checkoutMutation.mutate("business")}
                >
                  Upgrade to Business
                </Button>
              )}
              {hasStripeSubscription && (
                <Button variant="outline" loading={portalMutation.isPending} onClick={() => portalMutation.mutate()}>
                  Manage payment method
                </Button>
              )}
              {hasStripeSubscription && subscription.plan !== "business" && (
                <Button
                  variant="outline"
                  loading={changePlanMutation.isPending}
                  onClick={() => changePlanMutation.mutate("business")}
                >
                  Upgrade to Business
                </Button>
              )}
              {hasStripeSubscription && subscription.plan !== "pro" && (
                <Button
                  variant="outline"
                  loading={changePlanMutation.isPending}
                  onClick={() => changePlanMutation.mutate("pro")}
                >
                  Switch to Pro
                </Button>
              )}
              {hasStripeSubscription && !subscription.cancelAtPeriodEnd && (
                <Button
                  variant="destructive"
                  loading={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(true)}
                >
                  Cancel at period end
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
