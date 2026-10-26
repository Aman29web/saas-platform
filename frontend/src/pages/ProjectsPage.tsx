import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/auth/AuthContext";
import type { Project } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";

export function ProjectsPage() {
  const { activeOrgId, activeRole } = useAuth();
  const queryClient = useQueryClient();
  const [newProjectName, setNewProjectName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const canCreate = activeRole === "owner" || activeRole === "admin" || activeRole === "member";
  const canDelete = activeRole === "owner" || activeRole === "admin";

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects", activeOrgId],
    queryFn: async () => (await apiClient.get<Project[]>("/api/projects")).data,
    enabled: Boolean(activeOrgId),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => apiClient.post("/api/projects", { name }),
    onSuccess: () => {
      setNewProjectName("");
      queryClient.invalidateQueries({ queryKey: ["projects", activeOrgId] });
      queryClient.invalidateQueries({ queryKey: ["usage", activeOrgId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiClient.put(`/api/projects/${id}`, { name }),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["projects", activeOrgId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", activeOrgId] });
      queryClient.invalidateQueries({ queryKey: ["usage", activeOrgId] });
    },
  });

  if (!activeOrgId) return <p className="text-sm text-slate-500">No active organization.</p>;
  if (isLoading) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Projects</h1>
        <p className="text-sm text-slate-500">Sample tenant-scoped resource.</p>
      </div>

      {canCreate && (
        <Card>
          <CardContent className="flex items-end gap-3 py-4">
            <div className="flex-1">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newProjectName.trim()) createMutation.mutate(newProjectName.trim());
                }}
                className="flex items-end gap-3"
              >
                <div className="flex-1">
                  <Input
                    placeholder="New project name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                  />
                </div>
                <Button type="submit" loading={createMutation.isPending} disabled={!newProjectName.trim()}>
                  Add project
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All projects ({projects?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-slate-100 p-0">
          {!projects || projects.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No projects yet.</p>
          ) : (
            projects.map((project) => (
              <div key={project._id} className="flex items-center justify-between gap-3 px-5 py-3">
                {editingId === project._id ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      updateMutation.mutate({ id: project._id, name: editingName });
                    }}
                  >
                    <Input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="max-w-xs"
                    />
                    <Button size="sm" type="submit" loading={updateMutation.isPending}>
                      Save
                    </Button>
                    <Button size="sm" type="button" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{project.name}</p>
                      <p className="text-xs text-slate-400">
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {canCreate && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(project._id);
                            setEditingName(project.name);
                          }}
                        >
                          Rename
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="destructive"
                          loading={deleteMutation.isPending && deleteMutation.variables === project._id}
                          onClick={() => deleteMutation.mutate(project._id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
