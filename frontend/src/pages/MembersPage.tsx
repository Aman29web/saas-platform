import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/auth/AuthContext";
import type { Invitation, Member, Role } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";

export function MembersPage() {
  const { activeOrgId, activeRole, user } = useAuth();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");

  const canInvite = activeRole === "owner" || activeRole === "admin";
  const canChangeRole = activeRole === "owner";
  const canRemove = activeRole === "owner" || activeRole === "admin";

  const { data: members, isLoading: loadingMembers } = useQuery({
    queryKey: ["members", activeOrgId],
    queryFn: async () => (await apiClient.get<Member[]>("/api/memberships")).data,
    enabled: Boolean(activeOrgId),
  });

  const { data: invitations } = useQuery({
    queryKey: ["invitations", activeOrgId],
    queryFn: async () => (await apiClient.get<Invitation[]>("/api/invitations")).data,
    enabled: Boolean(activeOrgId) && canInvite,
  });

  const inviteMutation = useMutation({
    mutationFn: () => apiClient.post("/api/invitations", { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["invitations", activeOrgId] });
    },
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/invitations/${id}/resend`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invitations", activeOrgId] }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invitations", activeOrgId] }),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      apiClient.patch(`/api/memberships/${userId}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", activeOrgId] }),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/api/memberships/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", activeOrgId] }),
  });

  if (!activeOrgId) return <p className="text-sm text-slate-500">No active organization.</p>;
  if (loadingMembers) return <PageSpinner />;

  const pendingInvites = invitations?.filter((i) => !i.acceptedAt && !i.revokedAt) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Members</h1>
        <p className="text-sm text-slate-500">Manage who has access to this organization.</p>
      </div>

      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (inviteEmail.trim()) inviteMutation.mutate();
              }}
            >
              <div className="flex-1">
                <Input
                  type="email"
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className="w-32">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
              <Button type="submit" loading={inviteMutation.isPending}>
                Send invite
              </Button>
            </form>
            {inviteMutation.isError && (
              <p className="mt-2 text-sm text-red-600">Could not send invitation.</p>
            )}
          </CardContent>
        </Card>
      )}

      {canInvite && pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations ({pendingInvites.length})</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-slate-100 p-0">
            {pendingInvites.map((invite) => {
              const expired = new Date(invite.expiresAt).getTime() < Date.now();
              return (
                <div key={invite._id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{invite.email}</p>
                    <p className="text-xs text-slate-400 capitalize">
                      {invite.role} · {expired ? "expired" : `expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" loading={resendMutation.isPending} onClick={() => resendMutation.mutate(invite._id)}>
                      Resend
                    </Button>
                    <Button size="sm" variant="destructive" loading={revokeMutation.isPending} onClick={() => revokeMutation.mutate(invite._id)}>
                      Revoke
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members ({members?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-slate-100 p-0">
          {members?.map((member) => (
            <div key={member._id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{member.userId.name || member.userId.email}</p>
                <p className="text-xs text-slate-400">
                  {member.userId.email}
                  {member.userId._id === user?.id ? " · You" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canChangeRole && member.role !== "owner" ? (
                  <Select
                    value={member.role}
                    className="w-28"
                    disabled={changeRoleMutation.isPending}
                    onChange={(e) =>
                      changeRoleMutation.mutate({ userId: member.userId._id, role: e.target.value as Role })
                    }
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </Select>
                ) : (
                  <Badge variant={member.role === "owner" ? "success" : "default"} className="capitalize">
                    {member.role}
                  </Badge>
                )}
                {canRemove && member.role !== "owner" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={removeMutation.isPending && removeMutation.variables === member.userId._id}
                    onClick={() => removeMutation.mutate(member.userId._id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
