import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";

interface InvitePreview {
  email: string;
  role: string;
  orgName?: string;
  expired: boolean;
  revoked: boolean;
  accepted: boolean;
}

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const { user, refresh, switchOrg } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: async () => (await apiClient.get<InvitePreview>(`/api/invitations/public/${token}`)).data,
    enabled: Boolean(token),
  });

  const acceptMutation = useMutation({
    mutationFn: async () => (await apiClient.post<{ orgId: string }>("/api/invitations/public/accept", { token })).data,
    onSuccess: async (result) => {
      switchOrg(result.orgId);
      await refresh();
      navigate("/", { replace: true });
    },
  });

  if (!user) {
    return <Navigate to="/login" state={{ from: { pathname: `/invite/${token}` } }} replace />;
  }

  if (isLoading) return <PageSpinner />;

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-sm">
          <CardContent className="py-6 text-center text-sm text-slate-600">
            This invitation could not be found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const unusable = data.expired || data.revoked || data.accepted;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Join {data.orgName ?? "organization"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">
            You've been invited as <span className="font-medium capitalize">{data.role}</span> for{" "}
            <span className="font-medium">{data.email}</span>.
          </p>
          {data.revoked && <p className="text-sm text-red-600">This invitation has been revoked.</p>}
          {data.expired && !data.revoked && <p className="text-sm text-red-600">This invitation has expired.</p>}
          {data.accepted && <p className="text-sm text-amber-600">This invitation has already been accepted.</p>}
          {acceptMutation.isError && (
            <p className="text-sm text-red-600">Couldn't accept this invitation. It may not match your account email.</p>
          )}
          <Button
            disabled={unusable}
            loading={acceptMutation.isPending}
            onClick={() => acceptMutation.mutate()}
          >
            Accept invitation
          </Button>
          <Link to="/" className="text-center text-sm text-slate-500 hover:underline">
            Back to dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
