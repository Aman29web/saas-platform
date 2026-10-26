import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/auth/AuthContext";
import type { UsageDashboard } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";

const METRIC_LABELS: Record<string, string> = {
  api_calls: "API calls",
  seats: "Seats",
  projects: "Projects",
  storage_mb: "Storage (MB)",
};

export function UsagePage() {
  const { activeOrgId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["usage", activeOrgId],
    queryFn: async () => (await apiClient.get<UsageDashboard>("/api/usage")).data,
    enabled: Boolean(activeOrgId),
  });

  if (!activeOrgId) return <p className="text-sm text-slate-500">No active organization.</p>;
  if (isLoading) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Usage</h1>
        <p className="text-sm text-slate-500">
          Current plan: <span className="font-medium capitalize">{data?.plan}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data?.metrics.map((row) => {
          const pct = row.quota ? Math.min(100, Math.round((row.used / row.quota) * 100)) : 0;
          const over = row.quota !== null && row.used >= row.quota;
          return (
            <Card key={row.metric}>
              <CardHeader>
                <CardTitle className="text-sm">{METRIC_LABELS[row.metric] ?? row.metric}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-900">
                  {row.used.toLocaleString()}
                  <span className="ml-1 text-sm font-normal text-slate-400">
                    / {row.quota === null ? "∞" : row.quota.toLocaleString()}
                  </span>
                </p>
                {row.quota !== null && (
                  <div className="mt-3 h-2 w-full rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full ${over ? "bg-red-500" : "bg-slate-900"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                {over && <p className="mt-2 text-xs font-medium text-red-600">Quota reached</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
