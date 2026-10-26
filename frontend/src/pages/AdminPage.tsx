import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/auth/AuthContext";
import type { Project } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";

export function AdminPage() {
  const { refresh, switchOrg } = useAuth();
  const navigate = useNavigate();
  const [userId, setUserId] = useState("");
  const [orgId, setOrgId] = useState("");

  const { data: projects, isLoading } = useQuery({
    queryKey: ["admin-projects"],
    queryFn: async () => (await apiClient.get<Project[]>("/api/admin/projects")).data,
  });

  const impersonateMutation = useMutation({
    mutationFn: () => apiClient.post<{ orgId: string }>(`/api/admin/impersonate/${userId}/${orgId}`),
    onSuccess: async (res) => {
      switchOrg(res.data.orgId);
      await refresh();
      navigate("/", { replace: true });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Platform Admin</h1>
        <p className="text-sm text-slate-500">Cross-tenant tools, restricted to platform admins.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Impersonate a user</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (userId.trim() && orgId.trim()) impersonateMutation.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="userId">User ID</Label>
              <Input id="userId" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-64" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="orgId">Org ID</Label>
              <Input id="orgId" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-64" />
            </div>
            <Button type="submit" loading={impersonateMutation.isPending}>
              Start impersonation
            </Button>
          </form>
          {impersonateMutation.isError && (
            <p className="mt-2 text-sm text-red-600">Could not start impersonation for that user/org.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All projects across tenants ({projects?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-slate-100 p-0">
          {isLoading ? (
            <PageSpinner />
          ) : !projects || projects.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No projects found.</p>
          ) : (
            projects.map((project) => (
              <div key={project._id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{project.name}</p>
                  <p className="text-xs text-slate-400">
                    org: {project.tenantId} · created by {project.createdBy}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOrgId(project.tenantId);
                    setUserId(project.createdBy);
                  }}
                >
                  Prefill impersonation
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
